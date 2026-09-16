import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const operations = await readFile(new URL("./operations.ts", import.meta.url), "utf8");
const commandPoll = await readFile(
  new URL("../../app/api/companion/commands/route.ts", import.meta.url),
  "utf8",
);
const commandCompletion = await readFile(
  new URL("../../app/api/companion/commands/[commandId]/complete/route.ts", import.meta.url),
  "utf8",
);

describe("companion automatic Drive reconciliation contract", () => {
  it("queues unresolved Branches during periodic full reconciliation", () => {
    expect(operations).toContain("enqueueUnresolvedDriveBranches(device.ownerUserId)");
    expect(operations).toContain("processDriveIdentityQueue(device.ownerUserId)");
  });

  it("queues folder events and prioritizes folders newly marked as Branches", () => {
    expect(operations).toContain("enqueueDriveIdentity(device.ownerUserId, operation.relativePath!, false)");
    expect(operations).toContain("enqueueDriveIdentity(device.ownerUserId, operation.relativePath!, true)");
    expect(operations).toContain("retargetDriveIdentityPrefix");
    expect(operations).toContain("cancelDriveIdentityPrefix");
  });

  it("resumes durable jobs from the existing companion poll without a native-host change", () => {
    expect(commandPoll).toContain("processDriveIdentityQueue(device.ownerUserId, { limit: 1 })");
  });

  it("queues PlayHouse-created folders and Branch-state commands after local success", () => {
    expect(commandCompletion).toContain("enqueueDriveIdentity(device.ownerUserId, payload.relativePath");
    expect(commandCompletion).toContain("enqueueDriveIdentity(device.ownerUserId, command.relative_path, true)");
  });
});
