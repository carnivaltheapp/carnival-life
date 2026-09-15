export type DriveBackfillState = {
  message?: string;
  status: "idle" | "success" | "error";
};

export const INITIAL_DRIVE_BACKFILL_STATE: DriveBackfillState = { status: "idle" };
