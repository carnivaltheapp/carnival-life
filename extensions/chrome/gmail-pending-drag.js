export const GMAIL_PENDING_DRAG_STORAGE_KEY = "carnivalPendingGmailDrag";
export const GMAIL_PENDING_DRAG_TTL_MS = 30_000;

export async function storePendingGmailDrag(storage, record) {
  try {
    await storage.set({
      [GMAIL_PENDING_DRAG_STORAGE_KEY]: {
        lastOutcome: null,
        pending: record,
      },
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "storage-write-failed" };
  }
}

export async function getPendingGmailDrag(storage, now = Date.now()) {
  let state;
  try {
    const stored = await storage.get(GMAIL_PENDING_DRAG_STORAGE_KEY);
    state = stored[GMAIL_PENDING_DRAG_STORAGE_KEY];
  } catch {
    return { reason: "storage-read-failed", status: "missing" };
  }
  if (!state?.pending) {
    return {
      reason: state?.lastOutcome === "consumed" ? "already-consumed" : "never-stored",
      status: "missing",
    };
  }
  if (!Number.isFinite(state.pending.armedAt)) {
    return { reason: "not-armed", status: "missing" };
  }
  const ageMs = Math.max(0, now - state.pending.armedAt);
  if (ageMs > GMAIL_PENDING_DRAG_TTL_MS) {
    try {
      await storage.set({
        [GMAIL_PENDING_DRAG_STORAGE_KEY]: {
          lastActionId: state.pending.actionId,
          lastOutcome: "expired",
          pending: null,
        },
      });
    } catch {
      return { reason: "storage-read-failed", status: "missing" };
    }
    return { actionId: state.pending.actionId, ageMs, reason: "expired", status: "missing" };
  }
  return { ageMs, record: state.pending, status: "found" };
}

export async function consumePendingGmailDrag(storage, actionId, now = Date.now()) {
  const found = await getPendingGmailDrag(storage, now);
  if (found.status !== "found") return found;
  if (found.record.actionId !== actionId) {
    return { reason: "action-id-mismatch", status: "missing" };
  }
  try {
    await storage.set({
      [GMAIL_PENDING_DRAG_STORAGE_KEY]: {
        lastActionId: actionId,
        lastOutcome: "consumed",
        pending: null,
      },
    });
    return { actionId, status: "consumed" };
  } catch {
    return { reason: "storage-read-failed", status: "missing" };
  }
}
