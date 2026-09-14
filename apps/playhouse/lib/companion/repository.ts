import "server-only";

import type { Collection } from "mongodb";

import { getCarnivalMongoDatabase } from "../playhouse/mongo-client";
import {
  createDeviceCredential,
  createDeviceId,
  createPairingCode,
  secretHash,
} from "./security";

const DEVICE_COLLECTION = "carnival_companion_devices";
const PAIRING_COLLECTION = "carnival_companion_pairing_codes";
const OPERATION_COLLECTION = "carnival_companion_operations";
const COMMAND_COLLECTION = "carnival_companion_commands";
const PAIRING_TTL_MS = 10 * 60 * 1000;

type DeviceDocument = {
  credential_hash: string;
  created_at: Date;
  device_id: string;
  device_name: string;
  last_seen_at: Date | null;
  owner_user_id: string;
  revoked_at: Date | null;
  status: "active" | "revoked";
  updated_at: Date;
};

type PairingDocument = {
  code_hash: string;
  consumed_at: Date | null;
  created_at: Date;
  expires_at: Date;
  owner_user_id: string;
};

type CommandDocument = {
  command_id: string;
  completed_at: Date | null;
  created_at: Date;
  device_id: string;
  error: string | null;
  is_branch: boolean;
  name: string;
  owner_user_id: string;
  parent_relative_path: string;
  relative_path: string | null;
  status: "completed" | "failed" | "pending";
  type: "create_folder";
  updated_at: Date;
};

type OperationDocument = {
  completed_at: Date | null;
  created_at: Date;
  device_id: string;
  operation_id: string;
  owner_user_id: string;
  type: string;
};

export type CompanionDevice = Pick<
  DeviceDocument,
  "device_id" | "device_name" | "last_seen_at" | "status"
>;

type Collections = {
  commands: Collection<CommandDocument>;
  devices: Collection<DeviceDocument>;
  operations: Collection<OperationDocument>;
  pairing: Collection<PairingDocument>;
};

declare global {
  var carnivalCompanionIndexPromise: Promise<unknown> | undefined;
}

async function defaultCollections(): Promise<Collections> {
  const database = await getCarnivalMongoDatabase();
  const devices = database.collection<DeviceDocument>(DEVICE_COLLECTION);
  const pairing = database.collection<PairingDocument>(PAIRING_COLLECTION);
  const operations = database.collection<OperationDocument>(OPERATION_COLLECTION);
  const commands = database.collection<CommandDocument>(COMMAND_COLLECTION);
  globalThis.carnivalCompanionIndexPromise ??= Promise.all([
    devices.createIndex({ credential_hash: 1 }, { name: "credential_hash_unique", unique: true }),
    devices.createIndex({ owner_user_id: 1, status: 1 }, { name: "owner_device_status" }),
    pairing.createIndex({ code_hash: 1 }, { name: "pairing_code_unique", unique: true }),
    pairing.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: "pairing_code_ttl" }),
    operations.createIndex(
      { device_id: 1, operation_id: 1 },
      { name: "device_operation_unique", unique: true },
    ),
    commands.createIndex(
      { device_id: 1, status: 1, created_at: 1 },
      { name: "device_pending_commands" },
    ),
    commands.createIndex(
      { command_id: 1 },
      { name: "command_id_unique", unique: true },
    ),
  ]);
  await globalThis.carnivalCompanionIndexPromise;
  return { commands, devices, operations, pairing };
}

export class MongoCompanionRepository {
  constructor(private readonly collections: () => Promise<Collections> = defaultCollections) {}

  async createPairingCode(ownerUserId: string) {
    const code = createPairingCode();
    const now = new Date();
    await (await this.collections()).pairing.insertOne({
      code_hash: secretHash(code),
      consumed_at: null,
      created_at: now,
      expires_at: new Date(now.getTime() + PAIRING_TTL_MS),
      owner_user_id: ownerUserId,
    });
    return { code, expiresAt: new Date(now.getTime() + PAIRING_TTL_MS) };
  }

  async exchangePairingCode(code: string, deviceName: string) {
    const collections = await this.collections();
    const now = new Date();
    const pairing = await collections.pairing.findOneAndUpdate(
      { code_hash: secretHash(code), consumed_at: null, expires_at: { $gt: now } },
      { $set: { consumed_at: now } },
      { returnDocument: "after" },
    );
    if (!pairing) return null;
    const credential = createDeviceCredential();
    const deviceId = createDeviceId();
    await collections.devices.insertOne({
      credential_hash: secretHash(credential),
      created_at: now,
      device_id: deviceId,
      device_name: deviceName.trim().slice(0, 120) || "Windows companion",
      last_seen_at: now,
      owner_user_id: pairing.owner_user_id,
      revoked_at: null,
      status: "active",
      updated_at: now,
    });
    return { credential, deviceId };
  }

  async authenticate(credential: string) {
    const collections = await this.collections();
    const device = await collections.devices.findOne({
      credential_hash: secretHash(credential),
      revoked_at: null,
      status: "active",
    });
    if (!device) return null;
    const now = new Date();
    await collections.devices.updateOne(
      { device_id: device.device_id, owner_user_id: device.owner_user_id, status: "active" },
      { $set: { last_seen_at: now, updated_at: now } },
    );
    return { deviceId: device.device_id, ownerUserId: device.owner_user_id };
  }

  async listDevices(ownerUserId: string): Promise<CompanionDevice[]> {
    return (await (await this.collections()).devices.find(
      { owner_user_id: ownerUserId },
      { projection: { _id: 0, credential_hash: 0, owner_user_id: 0 } },
    ).sort({ created_at: -1 }).toArray()).map((device) => ({
      device_id: device.device_id,
      device_name: device.device_name,
      last_seen_at: device.last_seen_at,
      status: device.status,
    }));
  }

  async revoke(ownerUserId: string, deviceId: string) {
    const now = new Date();
    return (await (await this.collections()).devices.updateOne(
      { device_id: deviceId, owner_user_id: ownerUserId, status: "active" },
      { $set: { revoked_at: now, status: "revoked", updated_at: now } },
    )).modifiedCount === 1;
  }

  async findOnlineDevice(ownerUserId: string, since: Date) {
    return (await this.collections()).devices.findOne(
      { last_seen_at: { $gte: since }, owner_user_id: ownerUserId, status: "active" },
      { sort: { last_seen_at: -1 } },
    );
  }

  async createFolderCommand(ownerUserId: string, deviceId: string, input: {
    isBranch: boolean;
    name: string;
    parentRelativePath: string;
  }) {
    const commandId = createDeviceId();
    const now = new Date();
    await (await this.collections()).commands.insertOne({
      command_id: commandId,
      completed_at: null,
      created_at: now,
      device_id: deviceId,
      error: null,
      is_branch: input.isBranch,
      name: input.name,
      owner_user_id: ownerUserId,
      parent_relative_path: input.parentRelativePath,
      relative_path: null,
      status: "pending",
      type: "create_folder",
      updated_at: now,
    });
    return commandId;
  }

  async pendingFolderCommands(deviceId: string, ownerUserId: string) {
    return (await (await this.collections()).commands.find({
      device_id: deviceId,
      owner_user_id: ownerUserId,
      status: "pending",
      type: "create_folder",
    }).sort({ created_at: 1 }).limit(10).toArray()).map((command) => ({
      commandId: command.command_id,
      isBranch: command.is_branch,
      name: command.name,
      parentRelativePath: command.parent_relative_path,
    }));
  }

  async getPendingFolderCommand(deviceId: string, ownerUserId: string, commandId: string) {
    return (await this.collections()).commands.findOne({
      command_id: commandId,
      device_id: deviceId,
      owner_user_id: ownerUserId,
      status: "pending",
    });
  }

  async completeFolderCommand(deviceId: string, ownerUserId: string, commandId: string, result: {
    error?: string;
    ok: boolean;
    relativePath?: string;
  }) {
    const now = new Date();
    return (await (await this.collections()).commands.findOneAndUpdate(
      { command_id: commandId, device_id: deviceId, owner_user_id: ownerUserId, status: "pending" },
      { $set: {
        completed_at: now,
        error: result.ok ? null : (result.error ?? "folder_creation_failed").slice(0, 240),
        relative_path: result.ok ? result.relativePath ?? null : null,
        status: result.ok ? "completed" : "failed",
        updated_at: now,
      } },
      { returnDocument: "after" },
    )) ?? null;
  }

  async getFolderCommand(ownerUserId: string, commandId: string) {
    const command = await (await this.collections()).commands.findOne({
      command_id: commandId,
      owner_user_id: ownerUserId,
    });
    return command ? {
      error: command.error,
      relativePath: command.relative_path,
      status: command.status,
    } : null;
  }

  async beginOperation(ownerUserId: string, deviceId: string, operationId: string, type: string) {
    try {
      await (await this.collections()).operations.insertOne({
        completed_at: null,
        created_at: new Date(),
        device_id: deviceId,
        operation_id: operationId,
        owner_user_id: ownerUserId,
        type,
      });
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return false;
      throw error;
    }
  }

  async completeOperation(deviceId: string, operationId: string) {
    await (await this.collections()).operations.updateOne(
      { device_id: deviceId, operation_id: operationId },
      { $set: { completed_at: new Date() } },
    );
  }

  async abandonOperation(deviceId: string, operationId: string) {
    await (await this.collections()).operations.deleteOne({
      completed_at: null,
      device_id: deviceId,
      operation_id: operationId,
    });
  }
}

export const COMPANION_DEVICE_COLLECTION = DEVICE_COLLECTION;
export const COMPANION_PAIRING_COLLECTION = PAIRING_COLLECTION;
export const COMPANION_OPERATION_COLLECTION = OPERATION_COLLECTION;
export const COMPANION_COMMAND_COLLECTION = COMMAND_COLLECTION;
