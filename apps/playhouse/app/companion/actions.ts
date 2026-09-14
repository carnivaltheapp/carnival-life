"use server";

import { createClient } from "../../lib/supabase/server";
import { MongoCompanionRepository } from "../../lib/companion/repository";
import { MongoTreeOfLifeRepository } from "../../lib/tree-of-life/repository";
import { validateCompanionFolderRequest } from "../../domain/companion-folder";

async function ownerId() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return !error && typeof data?.claims?.sub === "string" ? data.claims.sub : null;
}

export async function listCompanionDevices() {
  const ownerUserId = await ownerId();
  if (!ownerUserId) return { devices: [], error: "Session unavailable." };
  return { devices: await new MongoCompanionRepository().listDevices(ownerUserId), error: null };
}

export async function generateCompanionPairingCode() {
  const ownerUserId = await ownerId();
  if (!ownerUserId) return { code: null, error: "Session unavailable.", expiresAt: null };
  const pairing = await new MongoCompanionRepository().createPairingCode(ownerUserId);
  return { code: pairing.code, error: null, expiresAt: pairing.expiresAt.toISOString() };
}

export async function revokeCompanionDevice(deviceId: string) {
  const ownerUserId = await ownerId();
  if (!ownerUserId) return { error: "Session unavailable.", ok: false };
  const ok = await new MongoCompanionRepository().revoke(ownerUserId, deviceId);
  return { error: ok ? null : "Device could not be revoked.", ok };
}

export async function listCompanionFolderOptions() {
  const ownerUserId = await ownerId();
  if (!ownerUserId) return { folders: [], error: "Session unavailable." };
  const folders = await new MongoTreeOfLifeRepository().listAllFoldersForOwner(ownerUserId);
  return { error: null, folders: folders.map((folder) => folder.relativePath) };
}

export async function requestCompanionFolderCreation(input: {
  isBranch: boolean;
  name: string;
  parentRelativePath: string;
}) {
  const ownerUserId = await ownerId();
  if (!ownerUserId) return { commandId: null, error: "Session unavailable." };
  const folders = await new MongoTreeOfLifeRepository().listAllFoldersForOwner(ownerUserId);
  const validated = validateCompanionFolderRequest(
    input,
    folders.map((folder) => folder.relativePath),
  );
  if (validated.error || validated.name === null || validated.parentRelativePath === null) {
    return { commandId: null, error: validated.error };
  }
  const repository = new MongoCompanionRepository();
  const device = await repository.findOnlineDevice(ownerUserId, new Date(Date.now() - 30_000));
  if (!device) return { commandId: null, error: "Desktop companion unavailable" };
  const commandId = await repository.createFolderCommand(ownerUserId, device.device_id, {
    isBranch: input.isBranch,
    name: validated.name,
    parentRelativePath: validated.parentRelativePath,
  });
  return { commandId, error: null };
}

export async function requestCompanionBranchState(relativePath: string, isBranch: boolean) {
  const ownerUserId = await ownerId();
  if (!ownerUserId) return { commandId: null, error: "Session unavailable.", unchanged: false };
  const folders = await new MongoTreeOfLifeRepository().listAllFoldersForOwner(ownerUserId);
  const folder = folders.find((candidate) => candidate.relativePath === relativePath);
  if (!folder) return { commandId: null, error: "Choose an existing synced folder.", unchanged: false };
  if (folder.isBranch === isBranch) return { commandId: null, error: null, unchanged: true };
  const repository = new MongoCompanionRepository();
  const device = await repository.findOnlineDevice(ownerUserId, new Date(Date.now() - 30_000));
  if (!device) return { commandId: null, error: "Desktop companion unavailable", unchanged: false };
  return {
    commandId: await repository.createBranchStateCommand(
      ownerUserId,
      device.device_id,
      relativePath,
      isBranch,
    ),
    error: null,
    unchanged: false,
  };
}

export async function getCompanionFolderCreationStatus(commandId: string) {
  const ownerUserId = await ownerId();
  if (!ownerUserId) return { error: "Session unavailable.", relativePath: null, status: "failed" as const };
  const command = await new MongoCompanionRepository().getFolderCommand(ownerUserId, commandId);
  if (!command) return { error: "Folder request was not found.", relativePath: null, status: "failed" as const };
  return command;
}
