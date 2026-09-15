import { describe, expect, it, vi } from "vitest";

import {
  GoogleDriveHierarchyResolver,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
} from "./drive";
import {
  GOOGLE_DRIVE_METADATA_READONLY_SCOPE,
  GOOGLE_OAUTH_SCOPES,
} from "./scopes";

function driveRequest(tree: Record<string, Record<string, Array<{ id: string; name: string }>>>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const query = url.searchParams.get("q") ?? "";
    const parent = /'([^']+)' in parents/.exec(query)?.[1] ?? "";
    const name = /name = '([^']+)'/.exec(query)?.[1] ?? "";
    return new Response(JSON.stringify({ files: tree[parent]?.[name] ?? [] }));
  }) as unknown as typeof fetch;
}

describe("Google Drive exact folder hierarchy", () => {
  it("requests the least-privilege metadata scope", () => {
    expect(GOOGLE_OAUTH_SCOPES).toContain(GOOGLE_DRIVE_METADATA_READONLY_SCOPE);
  });

  it("resolves BFLX segment-by-segment and returns every ancestor identity", async () => {
    const request = driveRequest({
      AUTO: { BFLX: [{ id: "BFLX123", name: "BFLX" }] },
      BFL: { Automation: [{ id: "AUTO", name: "Automation" }] },
      root: { "Blue Field Law": [{ id: "BFL", name: "Blue Field Law" }] },
    });
    const resolver = new GoogleDriveHierarchyResolver("secret-token", request);
    await expect(resolver.resolve("Blue Field Law\\Automation\\BFLX")).resolves.toEqual({
      folders: [
        {
          folderId: "BFL",
          relativePath: "Blue Field Law",
          webUrl: "https://drive.google.com/drive/folders/BFL",
        },
        {
          folderId: "AUTO",
          relativePath: "Blue Field Law/Automation",
          webUrl: "https://drive.google.com/drive/folders/AUTO",
        },
        {
          folderId: "BFLX123",
          relativePath: "Blue Field Law/Automation/BFLX",
          webUrl: "https://drive.google.com/drive/folders/BFLX123",
        },
      ],
      status: "resolved",
    });
    expect(request).toHaveBeenCalledTimes(3);
    for (const [url] of vi.mocked(request).mock.calls) {
      const parsed = new URL(String(url));
      expect(parsed.searchParams.get("q")).toContain(`mimeType = '${GOOGLE_DRIVE_FOLDER_MIME_TYPE}'`);
      expect(parsed.searchParams.get("q")).toContain("trashed = false");
      expect(parsed.searchParams.get("includeItemsFromAllDrives")).toBe("true");
      expect(parsed.searchParams.get("supportsAllDrives")).toBe("true");
    }
  });

  it("uses hierarchy to distinguish duplicate leaf names under different parents", async () => {
    const resolver = new GoogleDriveHierarchyResolver("token", driveRequest({
      AUTO: { BFLX: [{ id: "RIGHT", name: "BFLX" }] },
      BFL: {
        Automation: [{ id: "AUTO", name: "Automation" }],
        "Old Automation": [{ id: "OLD", name: "Old Automation" }],
      },
      OLD: { BFLX: [{ id: "WRONG", name: "BFLX" }] },
      root: { "Blue Field Law": [{ id: "BFL", name: "Blue Field Law" }] },
    }));
    const result = await resolver.resolve("Blue Field Law/Automation/BFLX");
    expect(result.status === "resolved" ? result.folders.at(-1)?.folderId : null).toBe("RIGHT");
  });

  it("returns ambiguous rather than choosing duplicate names under one parent", async () => {
    const resolver = new GoogleDriveHierarchyResolver("token", driveRequest({
      AUTO: { BFLX: [{ id: "ONE", name: "BFLX" }, { id: "TWO", name: "BFLX" }] },
      BFL: { Automation: [{ id: "AUTO", name: "Automation" }] },
      root: { "Blue Field Law": [{ id: "BFL", name: "Blue Field Law" }] },
    }));
    await expect(resolver.resolve("Blue Field Law/Automation/BFLX")).resolves.toEqual({
      candidateCount: 2,
      relativePath: "Blue Field Law/Automation/BFLX",
      status: "ambiguous",
    });
  });

  it("returns not_found without a global leaf-name fallback", async () => {
    const request = driveRequest({
      BFL: { Automation: [{ id: "AUTO", name: "Automation" }] },
      root: { "Blue Field Law": [{ id: "BFL", name: "Blue Field Law" }] },
    });
    const resolver = new GoogleDriveHierarchyResolver("token", request);
    await expect(resolver.resolve("Blue Field Law/Automation/Missing")).resolves.toEqual({
      relativePath: "Blue Field Law/Automation/Missing",
      status: "not_found",
    });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("returns auth_required for denied Drive metadata access", async () => {
    const request = vi.fn(async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    const resolver = new GoogleDriveHierarchyResolver("token", request);
    await expect(resolver.resolve("Blue Field Law")).resolves.toEqual({ status: "auth_required" });
  });

  it("caches shared ancestors across a backfill resolver session", async () => {
    const request = driveRequest({
      BFL: {
        Automation: [{ id: "AUTO", name: "Automation" }],
        Marketing: [{ id: "MKT", name: "Marketing" }],
      },
      root: { "Blue Field Law": [{ id: "BFL", name: "Blue Field Law" }] },
    });
    const resolver = new GoogleDriveHierarchyResolver("token", request);
    await resolver.resolve("Blue Field Law/Automation");
    await resolver.resolve("Blue Field Law/Marketing");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("supports an explicit Shared Drive root without changing path semantics", async () => {
    const request = driveRequest({ SHARED_ROOT: { Team: [{ id: "TEAM", name: "Team" }] } });
    const resolver = new GoogleDriveHierarchyResolver("token", request, "SHARED_ROOT", "DRIVE1");
    await expect(resolver.resolve("Team")).resolves.toMatchObject({ status: "resolved" });
    const url = new URL(String(vi.mocked(request).mock.calls[0][0]));
    expect(url.searchParams.get("corpora")).toBe("drive");
    expect(url.searchParams.get("driveId")).toBe("DRIVE1");
  });
});
