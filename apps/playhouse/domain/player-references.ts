import { isUuid } from "./play-input";

function isGoogleContactGroupResourceName(value: unknown): value is string {
  return typeof value === "string" && /^contactGroups\/[A-Za-z0-9_-]+$/.test(value);
}

export type SubmittedPlayerReference = {
  contactId?: string;
  displayName: string;
  kind: "contact" | "group";
  resourceName: string;
};

export function parseSubmittedPlayerReferences(
  raw: FormDataEntryValue | null,
): SubmittedPlayerReference[] | null | undefined {
  if (raw === null) return undefined;
  if (typeof raw !== "string") return null;
  try {
    const values = JSON.parse(raw) as unknown;
    if (!Array.isArray(values) || values.length > 50) return null;
    const references = values.flatMap((value): SubmittedPlayerReference[] => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const entry = value as Record<string, unknown>;
      const displayName = typeof entry.displayName === "string" ? entry.displayName.trim() : "";
      const resourceName = typeof entry.resourceName === "string" ? entry.resourceName.trim() : "";
      if (!displayName) return [];
      if (entry.kind === "contact" && typeof entry.id === "string" && isUuid(entry.id)) {
        return [{ contactId: entry.id, displayName, kind: "contact", resourceName }];
      }
      if (entry.kind === "group" && isGoogleContactGroupResourceName(resourceName)) {
        return [{ displayName, kind: "group", resourceName }];
      }
      return [];
    });
    return references.length === values.length &&
      new Set(references.map(({ kind, resourceName }) => `${kind}:${resourceName}`)).size === references.length
      ? references
      : null;
  } catch {
    return null;
  }
}
