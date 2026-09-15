export type DriveBackfillSummary = {
  alreadyResolved: number;
  ambiguous: number;
  authRequired: number;
  durationMs: number;
  errors: number;
  notFound: number;
  processed: number;
  resolved: number;
  unresolved: Array<{
    relativePath: string;
    status: "ambiguous" | "api_error" | "db_error" | "not_found";
  }>;
};

export type DriveBackfillState = {
  message?: string;
  status: "idle" | "success" | "error";
  summary?: DriveBackfillSummary;
};

export const INITIAL_DRIVE_BACKFILL_STATE: DriveBackfillState = { status: "idle" };
