import { describe, expect, it } from "vitest";

import { exactDriveFolderUrl } from "./tree-of-life-drive";

describe("exact Tree of Life Drive destination", () => {
  it("uses an exact stored folder ID", () => {
    expect(exactDriveFolderUrl({ driveFolderId: "ABC123" }))
      .toBe("https://drive.google.com/drive/folders/ABC123");
  });

  it("accepts only canonical stored Drive folder URLs", () => {
    expect(exactDriveFolderUrl({
      driveWebUrl: "https://drive.google.com/drive/u/0/folders/ABC123?resourcekey=key",
    })).toBe("https://drive.google.com/drive/u/0/folders/ABC123?resourcekey=key");
    expect(exactDriveFolderUrl({ driveWebUrl: "https://drive.google.com/drive/my-drive" }))
      .toBeNull();
    expect(exactDriveFolderUrl({ driveWebUrl: "https://example.com/drive/folders/ABC123" }))
      .toBeNull();
  });
});
