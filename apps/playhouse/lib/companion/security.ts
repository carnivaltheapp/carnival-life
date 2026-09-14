import { createHash, randomBytes, randomUUID } from "node:crypto";

export function secretHash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createPairingCode() {
  return randomBytes(9).toString("base64url").toUpperCase();
}

export function createDeviceCredential() {
  return randomBytes(32).toString("base64url");
}

export function createDeviceId() {
  return randomUUID();
}

export function bearerCredential(header: string | null) {
  const match = header?.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
  return match?.[1] ?? null;
}
