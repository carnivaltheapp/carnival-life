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

export function parseGmailPubSubEnvelope(
  value: unknown,
  expectedSubscription: string,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const envelope = value as GmailPubSubEnvelope;
  if (envelope.subscription !== expectedSubscription) {
    return null;
  }
  if (typeof envelope.message?.data !== "string") {
    return null;
  }
  try {
    const decodedValue: unknown = JSON.parse(
      Buffer.from(envelope.message.data, "base64url").toString("utf8"),
      (key, value, context?: { source?: string }) => {
        if (key === "historyId" && typeof value === "number" &&
            typeof context?.source === "string" && /^\d+$/.test(context.source)) {
          return context.source;
        }
        return value;
      },
    );
    const decoded = decodedValue && typeof decodedValue === "object" &&
        !Array.isArray(decodedValue)
      ? decodedValue as { emailAddress?: unknown; historyId?: unknown }
      : {};
    if (typeof decoded.emailAddress !== "string" ||
        !decoded.emailAddress.trim() ||
        typeof decoded.historyId !== "string" ||
        !/^\d+$/.test(decoded.historyId)) {
      return null;
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
    return null;
  }
}
