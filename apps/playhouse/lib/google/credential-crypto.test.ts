import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptGoogleRefreshToken,
  encryptGoogleRefreshToken,
} from "./credential-crypto";

describe("Google credential encryption", () => {
  it("encrypts a refresh token and authenticates it when decrypted", () => {
    const key = randomBytes(32).toString("base64");
    const credential = encryptGoogleRefreshToken("refresh-token-secret", key);

    expect(credential.encryptedRefreshToken).not.toContain("refresh-token-secret");
    expect(decryptGoogleRefreshToken(credential, key)).toBe(
      "refresh-token-secret",
    );
  });

  it("rejects decryption with a different key", () => {
    const credential = encryptGoogleRefreshToken(
      "refresh-token-secret",
      randomBytes(32).toString("base64"),
    );

    expect(() =>
      decryptGoogleRefreshToken(credential, randomBytes(32).toString("base64")),
    ).toThrow();
  });
});
