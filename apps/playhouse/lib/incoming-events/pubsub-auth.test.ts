import { describe, expect, it, vi } from "vitest";

import { parseGmailPubSubEnvelope, verifyPubSubAuthorization } from "./pubsub-auth";

describe("authenticated Gmail Pub/Sub notifications", () => {
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

  it("preserves a numeric Gmail history ID exactly as a string", () => {
    const subscription = "projects/project/subscriptions/sub";
    const historyId = "900719925474099312345";
    const data = Buffer.from(
      `{"emailAddress":"owner@example.com","historyId":${historyId}}`,
    ).toString("base64url");

    expect(parseGmailPubSubEnvelope({ message: { data }, subscription }, subscription))
      .toMatchObject({ historyId });
  });
});
