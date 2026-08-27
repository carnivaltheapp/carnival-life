import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { MongoClient } from "mongodb";

import {
  APPROVED_CUTOFF,
  assignRelativeSortOrder,
  findDuplicateLegacyIds,
  isApprovedCandidate,
  mapLegacyRecord,
  type LegacyRecord,
} from "./mapping";
import { buildSummary, humanSummary } from "./report";

async function main() {
  const uri = process.env.LEGACY_MONGO_URI;
  if (!uri) {
    throw new Error(
      "LEGACY_MONGO_URI is required. Keep it only in the gitignored .env.local file.",
    );
  }

  if (process.argv.slice(2).length > 0) {
    throw new Error("This command accepts no options and supports dry-run only.");
  }

  const client = new MongoClient(uri, {
    readPreference: "secondaryPreferred",
    serverSelectionTimeoutMS: 15_000,
  });

  try {
    await client.connect();
    const collection = client.db("restlandmark").collection<LegacyRecord>("tasks_task");
  const source = await collection
    .find({
      is_active: true,
      is_deleted: false,
      task_date: { $gte: APPROVED_CUTOFF },
    })
    .sort({ _id: 1 })
    .toArray();

  const records = source.filter(isApprovedCandidate).map(mapLegacyRecord);
  assignRelativeSortOrder(records);
  const duplicateLegacyIds = findDuplicateLegacyIds(records);
  for (const record of records.filter((item) => duplicateLegacyIds.includes(item.legacy.id))) {
    record.errors.push({
      code: "duplicate_legacy_id",
      message: "Legacy identifier occurs more than once and cannot be imported idempotently.",
    });
    record.classification = "needs_review";
    record.wouldImport = false;
  }

  const generatedAt = new Date().toISOString();
  const summary = buildSummary(records, duplicateLegacyIds);
  const reportDirectory = resolve("migration-reports");
  const fileStamp = generatedAt.replaceAll(":", "-");
  const jsonPath = resolve(reportDirectory, `legacy-play-dry-run-${fileStamp}.json`);
  const summaryPath = resolve(reportDirectory, `legacy-play-dry-run-${fileStamp}.txt`);
  const textReport = humanSummary(generatedAt, summary);

  await mkdir(reportDirectory, { recursive: true });
  await writeFile(
    jsonPath,
    `${JSON.stringify(
      {
        dryRun: true,
        generatedAt,
        source: {
          collection: "tasks_task",
          cutoff: APPROVED_CUTOFF.toISOString(),
          database: "restlandmark",
          filter: { isActive: true, isDeleted: false, taskDateGte: APPROVED_CUTOFF.toISOString() },
        },
        summary,
        records,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  await writeFile(summaryPath, textReport, { encoding: "utf8", flag: "wx" });

    process.stdout.write(textReport);
    process.stdout.write(`\nPrivate JSON report: ${jsonPath}\n`);
    process.stdout.write(`Private summary report: ${summaryPath}\n`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown migration dry-run error.";
  process.stderr.write(`Legacy migration dry-run failed: ${message}\n`);
  process.exitCode = 1;
});
