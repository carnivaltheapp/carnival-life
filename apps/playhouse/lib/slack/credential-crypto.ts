import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const AUTH_TAG_BYTES = 16;

export type EncryptedSlackCredential = {
  authenticationTag: string;
  encryptedAccessToken: string;
  encryptionIv: string;
  encryptionVersion: 1;
};

function keyFromBase64(encodedKey: string) {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) throw new Error("Slack token encryption is not configured correctly.");
  return key;
}

export function encryptSlackAccessToken(token: string, encodedKey: string): EncryptedSlackCredential {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyFromBase64(encodedKey), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    authenticationTag: cipher.getAuthTag().toString("base64"),
    encryptedAccessToken: ciphertext.toString("base64"),
    encryptionIv: iv.toString("base64"),
    encryptionVersion: 1,
  };
}

export function decryptSlackAccessToken(credential: EncryptedSlackCredential, encodedKey: string) {
  if (credential.encryptionVersion !== 1) throw new Error("Unsupported Slack credential encryption version.");
  const encrypted = Buffer.from(credential.encryptedAccessToken, "base64");
  const authenticationTag = Buffer.from(credential.authenticationTag, "base64");
  if (!encrypted.length || authenticationTag.length !== AUTH_TAG_BYTES) {
    throw new Error("Stored Slack credential is invalid.");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    keyFromBase64(encodedKey),
    Buffer.from(credential.encryptionIv, "base64"),
  );
  decipher.setAuthTag(authenticationTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
