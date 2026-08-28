const GOOGLE_DRIVE_BRANCH_PREFIX = "C:\\Google Drive\\";

export function displayBranch(branch: string | null) {
  return branch?.startsWith(GOOGLE_DRIVE_BRANCH_PREFIX)
    ? branch.slice(GOOGLE_DRIVE_BRANCH_PREFIX.length)
    : branch;
}

function objectValue(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonblankString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function gmailThreadIdFromMetadata(sourceMetadata: unknown) {
  const metadata = objectValue(sourceMetadata);
  if (!metadata) return null;
  return nonblankString(objectValue(metadata.external_ids)?.thread_id) ??
    nonblankString(objectValue(metadata.legacy_source)?.thread_id);
}

export function gmailThreadUrl(threadId: string) {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
}
