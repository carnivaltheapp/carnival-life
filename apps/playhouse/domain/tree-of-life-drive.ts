export type DriveFolderIdentity = {
  driveFolderId?: string | null;
  driveWebUrl?: string | null;
};

const DRIVE_FOLDER_ID = /^[A-Za-z0-9_-]+$/;

export function exactDriveFolderUrl(identity: DriveFolderIdentity) {
  const folderId = identity.driveFolderId?.trim();
  if (folderId && DRIVE_FOLDER_ID.test(folderId)) {
    return `https://drive.google.com/drive/folders/${folderId}`;
  }

  const value = identity.driveWebUrl?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "drive.google.com" ||
      !/^\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]+(?:\/|$)/.test(url.pathname)
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}
