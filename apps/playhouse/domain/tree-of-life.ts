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

export type TreeOfLifeFolderRecord = {
  active: boolean;
  depth: number;
  isBranch: boolean;
  name: string;
  parentRelativePath: string | null;
  relativePath: string;
};

export type FolderTreeNode = {
  children: FolderTreeNode[];
  isBranch: boolean;
  name: string;
  relativePath: string;
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

export function canonicalFolderRelativePath(value: string) {
  const path = canonicalRelativePath(value);
  if (!path || path.includes(":") || path.split("/").some((part) => part === ".." || !part)) {
    throw new Error("Folder path is invalid.");
  }
  return path;
}

export function treeOfLifeRelativePathFromBranch(value: string) {
  const normalized = value.trim().replaceAll("\\", "/");
  const relativePath = normalized
    .replace(/^C:\/Google Drive\//i, "")
    .replace(/^Google Drive\//i, "");
  return canonicalFolderRelativePath(relativePath);
}

export function parseFolderImage(value: unknown): TreeOfLifeFolderRecord[] {
  if (!Array.isArray(value)) throw new Error("Folder image must be an array.");
  const seen = new Set<string>();
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new Error("Folder record is malformed.");
    const input = candidate as Record<string, unknown>;
    const relativePath = canonicalFolderRelativePath(String(input.relativePath ?? ""));
    const parts = relativePath.split("/");
    const name = String(input.name ?? "").trim();
    const parentRelativePath = parts.length > 1 ? parts.slice(0, -1).join("/") : null;
    if (!name || parts.at(-1) !== name || seen.has(relativePath)) {
      throw new Error("Folder record has an invalid or duplicate path.");
    }
    seen.add(relativePath);
    return {
      active: true,
      depth: parts.length - 1,
      isBranch: input.isBranch === true,
      name,
      parentRelativePath,
      relativePath,
    };
  });
}

export function buildFolderTree(records: TreeOfLifeFolderRecord[]): FolderTreeNode[] {
  const nodes = new Map<string, FolderTreeNode>();
  for (const record of records.filter((record) => record.active)) {
    nodes.set(record.relativePath, {
      children: [],
      isBranch: record.isBranch,
      name: record.name,
      relativePath: record.relativePath,
    });
  }
  const roots: FolderTreeNode[] = [];
  for (const record of records.filter((record) => record.active)) {
    const node = nodes.get(record.relativePath)!;
    const parent = record.parentRelativePath ? nodes.get(record.parentRelativePath) : null;
    (parent?.children ?? roots).push(node);
  }
  const sort = (items: FolderTreeNode[]) => {
    items.sort((left, right) => left.name.localeCompare(right.name));
    items.forEach((item) => sort(item.children));
  };
  sort(roots);
  return roots;
}

export function branchTreeFromFolders(folders: FolderTreeNode[]): BranchTreeNode[] {
  return folders.flatMap((folder) => {
    const children = branchTreeFromFolders(folder.children);
    return folder.isBranch || children.length ? [{
      children,
      name: folder.name,
      relativePath: folder.relativePath,
      selectable: folder.isBranch,
    }] : [];
  });
}

export function branchTreeSummary(records: TreeOfLifeBranchRecord[]) {
  return {
    branchCount: records.filter((record) => record.active && record.selectable).length,
    topLevelCount: records.filter((record) => record.active && record.depth === 0).length,
  };
}

export function searchBranchTree(
  roots: BranchTreeNode[],
  query: string,
  limit = 50,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];
  const matches: BranchTreeNode[] = [];

  function visit(nodes: BranchTreeNode[]) {
    for (const node of nodes) {
      if (
        node.selectable &&
        (node.name.toLocaleLowerCase().includes(normalizedQuery) ||
          node.relativePath.toLocaleLowerCase().includes(normalizedQuery))
      ) matches.push(node);
      if (matches.length >= limit) return;
      visit(node.children);
      if (matches.length >= limit) return;
    }
  }

  visit(roots);
  return matches;
}

export function searchFolderTree(roots: FolderTreeNode[], query: string, limit = 75) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];
  const matches: FolderTreeNode[] = [];
  function visit(nodes: FolderTreeNode[]) {
    for (const node of nodes) {
      if (
        node.name.toLocaleLowerCase().includes(normalizedQuery) ||
        node.relativePath.toLocaleLowerCase().includes(normalizedQuery)
      ) matches.push(node);
      if (matches.length >= limit) return;
      visit(node.children);
      if (matches.length >= limit) return;
    }
  }
  visit(roots);
  return matches;
}

export function folderTrailForPath(
  roots: FolderTreeNode[],
  relativePath: string,
  ancestors: FolderTreeNode[] = [],
): FolderTreeNode[] | null {
  for (const node of roots) {
    const trail = [...ancestors, node];
    if (node.relativePath === relativePath) return trail;
    const childTrail = folderTrailForPath(node.children, relativePath, trail);
    if (childTrail) return childTrail;
  }
  return null;
}
