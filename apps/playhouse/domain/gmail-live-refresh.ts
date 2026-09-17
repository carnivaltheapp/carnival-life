export const GMAIL_LIVE_REFRESH_INTERVAL_MS = 5_000;

type GmailMutationResponse = {
  diagnostics?: Array<{ id?: unknown }>;
};

export function gmailMutationToken(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const diagnostics = (value as GmailMutationResponse).diagnostics;
  if (!Array.isArray(diagnostics) || diagnostics.length !== 1) return null;
  const id = diagnostics[0]?.id;
  return typeof id === "string" && id ? id : null;
}

export function observeGmailMutation(
  currentToken: string | null,
  nextToken: string | null,
) {
  return {
    refresh: currentToken !== null && nextToken !== null && currentToken !== nextToken,
    token: nextToken ?? currentToken,
  };
}
