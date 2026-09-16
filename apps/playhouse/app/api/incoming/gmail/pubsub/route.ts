import { NextResponse, type NextRequest } from "next/server";

import { processGmailNotification } from "../../../../../lib/incoming-events/gmail-watch.server";
import {
  parseGmailPubSubEnvelope,
  verifyPubSubAuthorization,
} from "../../../../../lib/incoming-events/pubsub-auth";

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error("CARNIVAL_INCOMING_EVENT GMAIL_NOTIFICATION_CONFIGURATION_INVALID", {
      variable: name,
    });
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

export async function POST(request: NextRequest) {
  try {
    const audience = requiredEnvironment("GMAIL_PUBSUB_AUDIENCE");
    const expectedServiceAccount = requiredEnvironment("GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL");
    const subscription = requiredEnvironment("GMAIL_PUBSUB_SUBSCRIPTION");
    const authenticated = await verifyPubSubAuthorization({
      audience,
      authorization: request.headers.get("authorization"),
      expectedServiceAccount,
    });
    if (!authenticated) {
      console.warn("CARNIVAL_INCOMING_EVENT GMAIL_NOTIFICATION_AUTH_FAILED");
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const notification = parseGmailPubSubEnvelope(await request.json(), subscription);
    if (!notification) {
      console.warn("CARNIVAL_INCOMING_EVENT GMAIL_NOTIFICATION_INVALID");
      return NextResponse.json({ error: "invalid_notification" }, { status: 400 });
    }
    console.info("CARNIVAL_INCOMING_EVENT GMAIL_NOTIFICATION_RECEIVED", {
      messageId: notification.messageId,
      publishTime: notification.publishTime,
    });
    const result = await processGmailNotification(notification);
    if ("busy" in result && result.busy) {
      return NextResponse.json({ retry: true }, { status: 503 });
    }
    return NextResponse.json({ accepted: true });
  } catch (error) {
    console.error("CARNIVAL_INCOMING_EVENT GMAIL_NOTIFICATION_FAILED", {
      reason: error instanceof Error ? error.name : "unknown_error",
    });
    return NextResponse.json({ error: "notification_failed" }, { status: 500 });
  }
}
