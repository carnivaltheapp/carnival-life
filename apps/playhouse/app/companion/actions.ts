"use server";

import { createClient } from "../../lib/supabase/server";
import { MongoCompanionRepository } from "../../lib/companion/repository";

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
