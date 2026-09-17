import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { parseGmailPubSubEnvelope, verifyPubSubAuthorization } from "./pubsub-auth";

describe("authenticated Gmail Pub/Sub notifications", () => {
  it("logs only the missing configuration variable name", () => {
    const route = readFileSync(
      new URL("../../app/api/incoming/gmail/pubsub/route.ts", import.meta.url),
      "utf8",
    );
    expect(route).toContain(
      'console.error("CARNIVAL_INCOMING_EVENT GMAIL_NOTIFICATION_CONFIGURATION_INVALID", {\n      variable: name,\n    })',
    );
    expect(route).not.toMatch(/variable:\s*process\.env/);
  });

  it("requires the signed audience and exact push service account", async () => {
    const verify = vi.fn().mockResolvedValue({
      aud: "https://example.com/hook",
      email: "push@example.iam.gserviceaccount.com",
      email_verified: true,
    });
    await expect(verifyPubSubAuthorization({
      audience: "https://example.com/hook",
      authorization: "Bearer signed-token",
      expectedServiceAccount: "push@example.iam.gserviceaccount.com",
      verify,
    })).resolves.toBe(true);
    await expect(verifyPubSubAuthorization({
      audience: "https://other.example/hook",
      authorization: "Bearer signed-token",
      expectedServiceAccount: "push@example.iam.gserviceaccount.com",
      verify,
    })).resolves.toBe(false);
  });

  it("accepts only the configured subscription and a valid Gmail signal", () => {
    const subscription = "projects/project/subscriptions/sub";
    const data = Buffer.from(JSON.stringify({
      emailAddress: "Owner@Example.com",
      historyId: "123",
    })).toString("base64url");
    expect(parseGmailPubSubEnvelope({
      message: { data, messageId: "pubsub-1" },
      subscription,
    }, subscription)).toMatchObject({
      emailAddress: "owner@example.com",
      historyId: "123",
      messageId: "pubsub-1",
    });
    expect(parseGmailPubSubEnvelope({ message: { data }, subscription: "wrong" }, subscription))
      .toBeNull();
  });

  it.each([
    ["envelope_invalid", null],
    ["subscription_mismatch", { message: { data: "ignored" }, subscription: "wrong" }],
    ["data_missing", { message: {}, subscription: "projects/project/subscriptions/sub" }],
    ["gmail_payload_invalid", {
      message: { data: Buffer.from("{}").toString("base64url") },
      subscription: "projects/project/subscriptions/sub",
    }],
  ])("logs only the safe %s validation stage", (stage, envelope) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(parseGmailPubSubEnvelope(
      envelope,
      "projects/project/subscriptions/sub",
    )).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "CARNIVAL_INCOMING_EVENT GMAIL_NOTIFICATION_VALIDATION_FAILED",
      { stage },
    );
    warn.mockRestore();
  });

  it("logs only privacy-safe structure when the Gmail history ID is not a string", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const subscription = "projects/project/subscriptions/sub";
    const data = Buffer.from(JSON.stringify({
      emailAddress: "owner@example.com",
      historyId: 123,
    })).toString("base64url");

    expect(parseGmailPubSubEnvelope({ message: { data }, subscription }, subscription))
      .toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "CARNIVAL_INCOMING_EVENT GMAIL_NOTIFICATION_PAYLOAD_STRUCTURE",
      {
        decoded_json_object: true,
        emailAddress_type: "string",
        emailAddress_nonblank: true,
        historyId_type: "number",
        historyId_string_digits_only: false,
      },
    );
    warn.mockRestore();
  });
});
