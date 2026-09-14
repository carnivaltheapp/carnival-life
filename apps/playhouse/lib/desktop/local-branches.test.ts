import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOCAL_BRANCHES_RESULT_SOURCE,
  LOCAL_BRANCHES_RESULT_TYPE,
  canonicalBranchValue,
  conciseBranchName,
  loadLocalBranches,
  resetLocalBranchCacheForTests,
} from "./local-branches";

function branchTarget(branches: unknown, ok = true) {
  let listener: ((event: MessageEvent) => void) | undefined;
  const target = {
    addEventListener: vi.fn((_type: string, value: EventListenerOrEventListenerObject) => {
      listener = value as (event: MessageEvent) => void;
    }),
    location: { origin: "https://carnival-playhouse.vercel.app" } as Location,
    postMessage: vi.fn((message: { requestId: string }) => queueMicrotask(() => listener?.({
      data: {
        branches,
        ok,
        requestId: message.requestId,
        source: LOCAL_BRANCHES_RESULT_SOURCE,
        type: LOCAL_BRANCHES_RESULT_TYPE,
      },
      origin: "https://carnival-playhouse.vercel.app",
    } as MessageEvent))),
    removeEventListener: vi.fn(),
  };
  return target;
}

const hierarchy = [{
  children: [{ children: [], name: "Paid Marketing", path: "Blue Field Law/Marketing/Paid Marketing", selectable: true }],
  name: "Marketing",
  path: "Blue Field Law/Marketing",
  selectable: false,
}];

describe("local Branch bridge", () => {
  beforeEach(() => {
    resetLocalBranchCacheForTests();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("loads and caches the compact hierarchy for instant subsequent drilling", async () => {
    const target = branchTarget(hierarchy);
    await expect(loadLocalBranches(target as never)).resolves.toEqual({ branches: hierarchy, ok: true });
    await expect(loadLocalBranches(target as never)).resolves.toEqual({ branches: hierarchy, ok: true });
    expect(target.postMessage).toHaveBeenCalledOnce();
    expect(console.info).toHaveBeenCalledWith("BRANCH_TREE_REQUESTED");
    expect(console.info).toHaveBeenCalledWith("BRANCH_TREE_DELIVERED", expect.objectContaining({
      branchCount: 1,
      topLevelCount: 1,
    }));
  });

  it("fails closed when the bridge returns malformed filesystem data", async () => {
    const target = branchTarget([{ name: "Document.txt", path: "Document.txt" }]);
    await expect(loadLocalBranches(target as never)).resolves.toEqual({ branches: [], ok: false });
  });

  it("uses the existing full Google Drive path convention while displaying the leaf", () => {
    const value = canonicalBranchValue("Blue Field Law/Marketing/Paid Marketing");
    expect(value).toBe("C:\\Google Drive\\Blue Field Law\\Marketing\\Paid Marketing");
    expect(conciseBranchName(value)).toBe("Paid Marketing");
  });
});
