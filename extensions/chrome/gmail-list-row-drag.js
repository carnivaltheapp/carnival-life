export const GMAIL_LIST_ROW_DRAG_STORAGE_KEY = "carnivalGmailListRowDrag";
export const GMAIL_LIST_ROW_DRAG_TTL_MS = 10_000;

export async function storeGmailListRowDrag(storage, payload, now = Date.now()) {
  await storage.set({
    [GMAIL_LIST_ROW_DRAG_STORAGE_KEY]: { createdAt: now, payload },
  });
  return { ok: true };
}

export async function getGmailListRowDrag(storage, now = Date.now()) {
  const stored = await storage.get(GMAIL_LIST_ROW_DRAG_STORAGE_KEY);
  const record = stored[GMAIL_LIST_ROW_DRAG_STORAGE_KEY];
  if (!record?.payload || !Number.isFinite(record.createdAt)) {
    return { reason: "missing", status: "missing" };
  }
  if (now - record.createdAt > GMAIL_LIST_ROW_DRAG_TTL_MS) {
    return { reason: "expired", status: "missing" };
  }
  return { payload: record.payload, status: "found" };
}

export async function consumeGmailListRowDrag(storage, correlationId, now = Date.now()) {
  const result = await getGmailListRowDrag(storage, now);
  if (result.status !== "found" || result.payload.correlationId !== correlationId) {
    return { reason: "mismatch", status: "missing" };
  }
  await storage.remove(GMAIL_LIST_ROW_DRAG_STORAGE_KEY);
  return { status: "consumed" };
}
