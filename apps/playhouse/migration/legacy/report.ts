import type { MappedRecord } from "./mapping";

type ReasonSummary = { code: string; count: number; representativeLegacyIds: string[] };

function summarizeReasons(records: MappedRecord[]) {
  const reasons = new Map<string, ReasonSummary>();
  for (const record of records) {
    for (const issue of [...record.errors, ...record.warnings]) {
      const existing = reasons.get(issue.code) ?? {
        code: issue.code,
        count: 0,
        representativeLegacyIds: [],
      };
      existing.count += 1;
      if (existing.representativeLegacyIds.length < 5) {
        existing.representativeLegacyIds.push(record.legacy.id);
      }
      reasons.set(issue.code, existing);
    }
  }
  return Array.from(reasons.values()).sort(
    (left, right) => right.count - left.count || left.code.localeCompare(right.code),
  );
}

export function buildSummary(records: MappedRecord[], duplicateLegacyIds: string[]) {
  const hasError = (record: MappedRecord, code: string) =>
    record.errors.some((issue) => issue.code === code);
  const placementCounts: Record<string, number> = {};
  const unsupportedBasketDates: Record<string, number> = {};
  const unsupportedPushRules: Record<string, number> = {};
  const unsupportedTaskTypes: Record<string, number> = {};
  for (const record of records) {
    const placement = record.mapped.placement;
    const label = !placement
      ? "Unresolved"
      : placement.kind === "calendar"
        ? "Calendar"
        : placement.basketName;
    placementCounts[label] = (placementCounts[label] ?? 0) + 1;
    if (hasError(record, "unsupported_basket_date")) {
      const value = record.legacy.taskDate?.slice(0, 10) ?? "(invalid)";
      unsupportedBasketDates[value] = (unsupportedBasketDates[value] ?? 0) + 1;
    }
    if (hasError(record, "unsupported_push_rule")) {
      const value = record.legacy.pushType ?? "(blank)";
      unsupportedPushRules[value] = (unsupportedPushRules[value] ?? 0) + 1;
    }
    if (hasError(record, "unsupported_task_type")) {
      const value = record.legacy.taskType ?? "(blank)";
      unsupportedTaskTypes[value] = (unsupportedTaskTypes[value] ?? 0) + 1;
    }
  }

  return {
    sourceCandidates: records.length,
    importableWithoutWarnings: records.filter((record) => record.classification === "importable").length,
    importableWithWarnings: records.filter(
      (record) => record.classification === "importable_with_warnings",
    ).length,
    needsReview: records.filter((record) => record.classification === "needs_review").length,
    unsupportedBasket: records.filter((record) => hasError(record, "unsupported_basket_date")).length,
    missingOrInvalidRequiredData: records.filter((record) =>
      record.errors.some((issue) => issue.code !== "unsupported_basket_date"),
    ).length,
    duplicateLegacyIdentifiers: duplicateLegacyIds.length,
    wouldImport: records.filter((record) => record.wouldImport).length,
    actuallyWritten: 0 as const,
    normal: records.filter((record) => record.mapped.playType === "normal").length,
    reminder: records.filter((record) => record.mapped.playType === "reminder").length,
    email: records.filter((record) => record.mapped.sourceType === "gmail").length,
    withPlayerReference: records.filter((record) => Boolean(record.mapped.player)).length,
    withCalendarIds: records.filter(
      (record) => Boolean(record.mapped.externalIds.eventId || record.mapped.externalIds.longCalendarId),
    ).length,
    withGmailThreadIds: records.filter((record) => Boolean(record.mapped.externalIds.threadId)).length,
    placementCounts,
    unsupportedBasketDates,
    unsupportedPushRules,
    unsupportedTaskTypes,
    reasons: summarizeReasons(records),
  };
}

export function humanSummary(
  generatedAt: string,
  summary: ReturnType<typeof buildSummary>,
) {
  const lines = [
    "Carnival PlayHouse legacy migration dry-run",
    `Generated: ${generatedAt}`,
    "Mongo source: restlandmark.tasks_task (read-only)",
    "Supabase writes: structurally unavailable",
    "",
    `Source candidates: ${summary.sourceCandidates}`,
    `Importable without warnings: ${summary.importableWithoutWarnings}`,
    `Importable with warnings: ${summary.importableWithWarnings}`,
    `Needs review: ${summary.needsReview}`,
    `Unsupported Basket: ${summary.unsupportedBasket}`,
    `Missing/invalid required data: ${summary.missingOrInvalidRequiredData}`,
    `Duplicate legacy identifiers: ${summary.duplicateLegacyIdentifiers}`,
    `Would import: ${summary.wouldImport}`,
    `Actually written: ${summary.actuallyWritten}`,
    "",
    `Normal: ${summary.normal}`,
    `Reminder: ${summary.reminder}`,
    `Email Plays: ${summary.email}`,
    `With legacy Player reference: ${summary.withPlayerReference}`,
    `With Calendar IDs: ${summary.withCalendarIds}`,
    `With Gmail thread IDs: ${summary.withGmailThreadIds}`,
    "",
    "Placement counts:",
    ...Object.entries(summary.placementCounts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, count]) => `  ${name}: ${count}`),
    "",
    "Unsupported Basket sentinel dates:",
    ...Object.entries(summary.unsupportedBasketDates)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, count]) => `  ${value}: ${count}`),
    "",
    "Unsupported task_type values:",
    ...Object.entries(summary.unsupportedTaskTypes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, count]) => `  ${value}: ${count}`),
    "",
    "Unsupported push_type values:",
    ...Object.entries(summary.unsupportedPushRules)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, count]) => `  ${value}: ${count}`),
    "",
    "Warnings/rejections:",
    ...summary.reasons.map(
      (reason) =>
        `  ${reason.code}: ${reason.count} (examples: ${reason.representativeLegacyIds.join(", ")})`,
    ),
    "",
    "Actually written: 0",
  ];
  return `${lines.join("\n")}\n`;
}
