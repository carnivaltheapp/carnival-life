import { canonicalFolderRelativePath } from "../../domain/tree-of-life";
import { exactDriveFolderUrl } from "../../domain/tree-of-life-drive";

export const GOOGLE_DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

type DriveFile = {
  id?: unknown;
  name?: unknown;
};

type DriveFileList = {
  files?: DriveFile[];
  nextPageToken?: unknown;
};

export type ResolvedDriveFolder = {
  folderId: string;
  relativePath: string;
  webUrl: string;
};

export type DriveFolderResolution =
  | { folders: ResolvedDriveFolder[]; status: "resolved" }
  | { candidateCount: number; relativePath: string; status: "ambiguous" }
  | { relativePath: string; status: "not_found" }
  | { status: "auth_required" };

export class GoogleDriveApiError extends Error {
  constructor(public readonly status: number) {
    super("Google Drive folder metadata could not be read.");
    this.name = "GoogleDriveApiError";
  }
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function driveQueryLiteral(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

export class GoogleDriveHierarchyResolver {
  private readonly childCache = new Map<string, Promise<DriveFile[]>>();

  constructor(
    private readonly accessToken: string,
    private readonly request: typeof fetch = fetch,
    private readonly rootFolderId = "root",
    private readonly sharedDriveId: string | null = null,
  ) {}

  private children(parentId: string, name: string) {
    const key = `${parentId}\u0000${name}`;
    const existing = this.childCache.get(key);
    if (existing) return existing;
    const pending = this.listChildren(parentId, name);
    this.childCache.set(key, pending);
    return pending;
  }

  private async listChildren(parentId: string, name: string) {
    const matches: DriveFile[] = [];
    const seenTokens = new Set<string>();
    let pageToken: string | null = null;
    do {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("corpora", this.sharedDriveId ? "drive" : "user");
      if (this.sharedDriveId) url.searchParams.set("driveId", this.sharedDriveId);
      url.searchParams.set("fields", "nextPageToken,files(id,name)");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      url.searchParams.set("pageSize", "1000");
      url.searchParams.set("q", [
        `'${driveQueryLiteral(parentId)}' in parents`,
        `name = '${driveQueryLiteral(name)}'`,
        `mimeType = '${GOOGLE_DRIVE_FOLDER_MIME_TYPE}'`,
        "trashed = false",
      ].join(" and "));
      url.searchParams.set("spaces", "drive");
      url.searchParams.set("supportsAllDrives", "true");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await this.request(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (response.status === 401 || response.status === 403) {
        throw new GoogleDriveApiError(response.status);
      }
      if (!response.ok) throw new GoogleDriveApiError(response.status);
      const page = (await response.json()) as DriveFileList;
      matches.push(...(page.files ?? []).filter((file) => text(file.id)));
      pageToken = text(page.nextPageToken);
      if (pageToken && seenTokens.has(pageToken)) {
        throw new Error("Google Drive folder search returned invalid pagination.");
      }
      if (pageToken) seenTokens.add(pageToken);
    } while (pageToken);
    return matches;
  }

  async resolve(relativePath: string): Promise<DriveFolderResolution> {
    const canonicalPath = canonicalFolderRelativePath(relativePath);
    const segments = canonicalPath.split("/");
    const folders: ResolvedDriveFolder[] = [];
    let parentId = this.rootFolderId;
    for (let index = 0; index < segments.length; index += 1) {
      const name = segments[index];
      const currentPath = segments.slice(0, index + 1).join("/");
      console.info("DRIVE_RESOLVE_SEGMENT", { relativePath: currentPath });
      let candidates: DriveFile[];
      try {
        candidates = await this.children(parentId, name);
      } catch (error) {
        if (error instanceof GoogleDriveApiError && (error.status === 401 || error.status === 403)) {
          return { status: "auth_required" };
        }
        throw error;
      }
      if (candidates.length === 0) {
        console.warn("CARNIVAL_DRIVE_RESOLVE SEGMENT", {
          candidateCount: 0,
          parentFolderId: parentId,
          relativePath: currentPath,
          segmentName: name,
          status: "not_found",
        });
        return { relativePath: currentPath, status: "not_found" };
      }
      if (candidates.length > 1) {
        console.warn("CARNIVAL_DRIVE_RESOLVE SEGMENT", {
          candidateCount: candidates.length,
          parentFolderId: parentId,
          relativePath: currentPath,
          segmentName: name,
          status: "ambiguous",
        });
        return { candidateCount: candidates.length, relativePath: currentPath, status: "ambiguous" };
      }
      const folderId = text(candidates[0].id)!;
      console.info("CARNIVAL_DRIVE_RESOLVE SEGMENT", {
        candidateCount: 1,
        parentFolderId: parentId,
        relativePath: currentPath,
        resolvedFolderId: folderId,
        segmentName: name,
        status: "resolved",
      });
      const webUrl = exactDriveFolderUrl({ driveFolderId: folderId })!;
      folders.push({ folderId, relativePath: currentPath, webUrl });
      parentId = folderId;
    }
    return { folders, status: "resolved" };
  }
}
