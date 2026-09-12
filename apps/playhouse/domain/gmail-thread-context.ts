export type GmailParticipant = { email: string; name: string | null };
export type GmailThreadContext = {
  from: GmailParticipant;
  lastMessageAt: string | null;
  to: GmailParticipant[];
};

function normalizedEmail(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function resolveGmailCounterparty(
  context: GmailThreadContext,
  selfEmails: string[],
) {
  const self = new Set(selfEmails.map(normalizedEmail));
  const fromIsSelf = self.has(normalizedEmail(context.from.email));
  const counterparty = fromIsSelf
    ? context.to.find(({ email }) => !self.has(normalizedEmail(email))) ?? null
    : self.has(normalizedEmail(context.from.email)) ? null : context.from;
  return counterparty
    ? { counterparty, direction: fromIsSelf ? "outgoing" as const : "incoming" as const }
    : null;
}

export function gmailPlayTypeForDirection(direction: "incoming" | "outgoing") {
  return direction === "outgoing" ? "reminder" as const : "normal" as const;
}

export function sanitizeGmailThreadContext(value: unknown): GmailThreadContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const participant = (item: unknown): GmailParticipant | null => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const candidate = item as Record<string, unknown>;
    const email = typeof candidate.email === "string" ? candidate.email.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return null;
    const name = typeof candidate.name === "string" && candidate.name.trim()
      ? candidate.name.trim().slice(0, 200)
      : null;
    return { email, name };
  };
  const from = participant(raw.from);
  const to = Array.isArray(raw.to) ? raw.to.flatMap((item) => {
    const result = participant(item);
    return result ? [result] : [];
  }).slice(0, 20) : [];
  if (!from || !to.length) return null;
  return {
    from,
    lastMessageAt: typeof raw.lastMessageAt === "string" ? raw.lastMessageAt.slice(0, 100) : null,
    to,
  };
}
