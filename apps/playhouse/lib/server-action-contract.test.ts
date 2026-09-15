import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("../", import.meta.url));

function hasModifier(node: ts.Node, kind: ts.SyntaxKind) {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind);
}

function hasUseServerDirective(source: ts.SourceFile) {
  return source.statements.some((statement) =>
    ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression) &&
    statement.expression.text === "use server"
  );
}

function runtimeExportViolations(sourceText: string, fileName: string) {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  if (!hasUseServerDirective(source)) return [];

  const violations: string[] = [];
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const typeOnly = statement.isTypeOnly || (
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.every((element) => element.isTypeOnly)
      );
      if (!typeOnly) violations.push("runtime re-export");
      continue;
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
    if (ts.isFunctionDeclaration(statement)) {
      if (!hasModifier(statement, ts.SyntaxKind.AsyncKeyword)) {
        violations.push(`non-async function ${statement.name?.text ?? "default"}`);
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        const asyncFunction = Boolean(
          initializer &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
          hasModifier(initializer, ts.SyntaxKind.AsyncKeyword)
        );
        if (!asyncFunction) violations.push(`runtime value ${declaration.name.getText(source)}`);
      }
      continue;
    }
    violations.push(ts.SyntaxKind[statement.kind]);
  }
  return violations;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      return entry.name.startsWith(".") || entry.name === "node_modules" ? [] : sourceFiles(path);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) && !/\.test\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

describe('"use server" export contract', () => {
  it("rejects the runtime object pattern that caused the production 500", () => {
    expect(runtimeExportViolations(
      '"use server";\nexport const INITIAL_STATE = { status: "idle" };',
      "fixture.ts",
    )).toEqual(["runtime value INITIAL_STATE"]);
  });

  it("allows async actions and erased type exports", () => {
    expect(runtimeExportViolations(
      '"use server";\nexport type State = { ok: boolean };\nexport async function action() {}',
      "fixture.ts",
    )).toEqual([]);
  });

  it("audits every PlayHouse server-action entrypoint", async () => {
    const files = await sourceFiles(appRoot);
    const serverActionFiles: string[] = [];
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      if (!hasUseServerDirective(parsed)) continue;
      serverActionFiles.push(file);
      for (const violation of runtimeExportViolations(source, file)) {
        violations.push(`${file}: ${violation}`);
      }
    }
    expect(serverActionFiles).toHaveLength(7);
    expect(violations).toEqual([]);
  });
});
