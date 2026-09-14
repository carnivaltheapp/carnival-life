export type BranchTreeNode = {
  children: BranchTreeNode[];
  name: string;
  relativePath: string;
  selectable: boolean;
};

export type TreeOfLifeBranchRecord = {
  active: boolean;
  depth: number;
  name: string;
  parentRelativePath: string | null;
  relativePath: string;
  selectable: boolean;
};

function canonicalRelativePath(value: string) {
  return value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

export function flattenBranchTree(value: unknown): TreeOfLifeBranchRecord[] {
  if (!Array.isArray(value)) throw new Error("Branch tree must be an array.");
  const records: TreeOfLifeBranchRecord[] = [];
  const paths = new Set<string>();

  function visit(nodes: unknown[], parentRelativePath: string | null, depth: number) {
    if (depth > 20) throw new Error("Branch tree exceeds the supported depth.");
    for (const candidate of nodes) {
      if (!candidate || typeof candidate !== "object") throw new Error("Branch node is malformed.");
      const node = candidate as Record<string, unknown>;
      const rawPath = typeof node.relativePath === "string"
        ? node.relativePath
        : typeof node.path === "string" ? node.path : "";
      const relativePath = canonicalRelativePath(rawPath);
      const segments = relativePath.split("/").filter(Boolean);
      const name = typeof node.name === "string" ? node.name.trim() : "";
      if (
        !relativePath || !name || typeof node.selectable !== "boolean" ||
        !Array.isArray(node.children) || segments.includes("..") ||
        relativePath.includes(":") || segments.at(-1) !== name ||
        (parentRelativePath ? relativePath !== `${parentRelativePath}/${name}` : segments.length !== 1) ||
        paths.has(relativePath)
      ) throw new Error("Branch node has an invalid or duplicate relative path.");

      paths.add(relativePath);
      records.push({
        active: true,
        depth,
        name,
        parentRelativePath,
        relativePath,
        selectable: node.selectable,
      });
      visit(node.children, relativePath, depth + 1);
    }
  }

  visit(value, null, 0);
  return records;
}

export function buildBranchTree(records: TreeOfLifeBranchRecord[]): BranchTreeNode[] {
  const activeRecords = records
    .filter((record) => record.active)
    .toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
  const nodes = new Map<string, BranchTreeNode>();
  for (const record of activeRecords) {
    nodes.set(record.relativePath, {
      children: [],
      name: record.name,
      relativePath: record.relativePath,
      selectable: record.selectable,
    });
  }

  const roots: BranchTreeNode[] = [];
  for (const record of activeRecords) {
    const node = nodes.get(record.relativePath)!;
    const parent = record.parentRelativePath ? nodes.get(record.parentRelativePath) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function branchTreeSummary(records: TreeOfLifeBranchRecord[]) {
  return {
    branchCount: records.filter((record) => record.active && record.selectable).length,
    topLevelCount: records.filter((record) => record.active && record.depth === 0).length,
  };
}
