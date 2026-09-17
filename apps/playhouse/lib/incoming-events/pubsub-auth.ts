import { OAuth2Client } from "google-auth-library";

export type PubSubClaims = {
  aud?: string | string[];
  email?: string;
  email_verified?: boolean;
};

export async function verifyPubSubAuthorization({
  authorization,
  audience,
  expectedServiceAccount,
  verify = async (token: string, expectedAudience: string) => {
    const ticket = await new OAuth2Client().verifyIdToken({
      audience: expectedAudience,
      idToken: token,
    });
    return ticket.getPayload() as PubSubClaims | undefined;
  },
}: {
  authorization: string | null;
  audience: string;
  expectedServiceAccount: string;
  verify?: (token: string, audience: string) => Promise<PubSubClaims | undefined>;
}) {
  const token = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
  if (!token) return false;
  try {
    const claims = await verify(token, audience);
    const audiences = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
    return claims?.email_verified === true &&
      claims.email?.toLocaleLowerCase() === expectedServiceAccount.toLocaleLowerCase() &&
      audiences.includes(audience);
  } catch {
    return false;
  }
}

export type GmailPubSubEnvelope = {
  message?: {
    data?: unknown;
    messageId?: unknown;
    publishTime?: unknown;
  };
  subscription?: unknown;
};

type GmailPubSubValidationStage =
  | "envelope_invalid"
  | "subscription_mismatch"
  | "data_missing"
  | "gmail_payload_invalid";

function invalidGmailPubSubNotification(stage: GmailPubSubValidationStage) {
  console.warn("CARNIVAL_INCOMING_EVENT GMAIL_NOTIFICATION_VALIDATION_FAILED", {
    stage,
  });
  return null;
}

function payloadFieldType(value: unknown) {
  if (value === undefined) return "missing";
  if (typeof value === "string" || typeof value === "number") return typeof value;
  return "other";
}

function logInvalidGmailPayload(value: unknown) {
  const decodedJsonObject = Boolean(
    value && typeof value === "object" && !Array.isArray(value),
  );
  const payload = decodedJsonObject ? value as Record<string, unknown> : {};
  console.warn("CARNIVAL_INCOMING_EVENT GMAIL_NOTIFICATION_PAYLOAD_STRUCTURE", {
    decoded_json_object: decodedJsonObject,
    emailAddress_type: payloadFieldType(payload.emailAddress),
    emailAddress_nonblank: typeof payload.emailAddress === "string" &&
      Boolean(payload.emailAddress.trim()),
    historyId_type: payloadFieldType(payload.historyId),
    historyId_string_digits_only: typeof payload.historyId === "string" &&
      /^\d+$/.test(payload.historyId),
  });
}

export function parseGmailPubSubEnvelope(
  value: unknown,
  expectedSubscription: string,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidGmailPubSubNotification("envelope_invalid");
  }
  const envelope = value as GmailPubSubEnvelope;
  if (envelope.subscription !== expectedSubscription) {
    return invalidGmailPubSubNotification("subscription_mismatch");
  }
  if (typeof envelope.message?.data !== "string") {
    return invalidGmailPubSubNotification("data_missing");
  }
  try {
    const decodedValue: unknown = JSON.parse(
      Buffer.from(envelope.message.data, "base64url").toString("utf8"),
    );
    const decoded = decodedValue && typeof decodedValue === "object" &&
        !Array.isArray(decodedValue)
      ? decodedValue as { emailAddress?: unknown; historyId?: unknown }
      : {};
    if (typeof decoded.emailAddress !== "string" ||
        !decoded.emailAddress.trim() ||
        typeof decoded.historyId !== "string" ||
        !/^\d+$/.test(decoded.historyId)) {
      logInvalidGmailPayload(decodedValue);
      return invalidGmailPubSubNotification("gmail_payload_invalid");
    }
    return {
      emailAddress: decoded.emailAddress.trim().toLocaleLowerCase(),
      historyId: decoded.historyId,
      messageId: typeof envelope.message.messageId === "string"
        ? envelope.message.messageId
        : null,
      publishTime: typeof envelope.message.publishTime === "string"
        ? envelope.message.publishTime
        : null,
    };
  } catch {
    logInvalidGmailPayload(null);
    return invalidGmailPubSubNotification("gmail_payload_invalid");
  }
}
