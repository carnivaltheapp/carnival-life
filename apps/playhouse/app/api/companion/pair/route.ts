import { NextResponse } from "next/server";

import { MongoCompanionRepository } from "../../../../lib/companion/repository";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const code = typeof (payload as { code?: unknown }).code === "string"
    ? (payload as { code: string }).code.trim().toUpperCase()
    : "";
  const deviceName = typeof (payload as { deviceName?: unknown }).deviceName === "string"
    ? (payload as { deviceName: string }).deviceName
    : "Windows companion";
  if (!code) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const paired = await new MongoCompanionRepository().exchangePairingCode(code, deviceName);
  if (!paired) return NextResponse.json({ error: "pairing_code_invalid" }, { status: 401 });
  return NextResponse.json(paired, { headers: { "Cache-Control": "no-store" } });
}
