export const LOCAL_BRANCHES_MESSAGE_SOURCE = "carnival-playhouse";
export const LOCAL_BRANCHES_MESSAGE_TYPE = "getLocalBranches";
export const LOCAL_BRANCHES_RESULT_SOURCE = "carnival-playhouse-bridge";
export const LOCAL_BRANCHES_RESULT_TYPE = "localBranchesResult";

export type LocalBranchNode = {
  children: LocalBranchNode[];
  name: string;
  path: string;
  selectable: boolean;
};

type LocalBranchTarget = Pick<Window, "addEventListener" | "location" | "postMessage" | "removeEventListener">;

let requestSequence = 0;
let cachedBranches: LocalBranchNode[] | null = null;

export async function loadLocalBranches(
  target: LocalBranchTarget = window,
): Promise<{ branches: LocalBranchNode[]; ok: boolean }> {
  if (cachedBranches) return { branches: cachedBranches, ok: true };
  const requestId = `branches-${Date.now()}-${++requestSequence}`;
  return new Promise((resolve) => {
    const timeout = globalThis.setTimeout(() => finish(false, []), 15000);
    function finish(ok: boolean, branches: LocalBranchNode[]) {
      globalThis.clearTimeout(timeout);
      target.removeEventListener("message", onMessage);
      if (ok) cachedBranches = branches;
      resolve({ branches, ok });
    }
    function onMessage(event: MessageEvent) {
      if (
        event.origin !== target.location.origin ||
        event.data?.source !== LOCAL_BRANCHES_RESULT_SOURCE ||
        event.data?.type !== LOCAL_BRANCHES_RESULT_TYPE ||
        event.data?.requestId !== requestId
      ) return;
      const branches = validBranchNodes(event.data.branches);
      finish(event.data.ok === true && branches !== null, branches ?? []);
    }
    target.addEventListener("message", onMessage);
    target.postMessage({
      requestId,
      source: LOCAL_BRANCHES_MESSAGE_SOURCE,
      type: LOCAL_BRANCHES_MESSAGE_TYPE,
    }, target.location.origin);
  });
}

function validBranchNodes(value: unknown, depth = 0): LocalBranchNode[] | null {
  if (!Array.isArray(value) || depth > 20) return null;
  const nodes: LocalBranchNode[] = [];
  for (const candidate of value) {
    if (
      !candidate || typeof candidate !== "object" ||
      typeof candidate.name !== "string" || typeof candidate.path !== "string" ||
      typeof candidate.selectable !== "boolean"
    ) return null;
    const children = validBranchNodes(candidate.children, depth + 1);
    if (!children) return null;
    nodes.push({
      children,
      name: candidate.name,
      path: candidate.path,
      selectable: candidate.selectable,
    });
  }
  return nodes;
}

export function canonicalBranchValue(relativePath: string) {
  return `C:\\Google Drive\\${relativePath.replaceAll("/", "\\")}`;
}

export function conciseBranchName(branch: string) {
  return branch.split(/[\\/]/).filter(Boolean).at(-1) ?? branch;
}

export function resetLocalBranchCacheForTests() {
  cachedBranches = null;
  requestSequence = 0;
}
