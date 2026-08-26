import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const AUTH_TAG_BYTES = 16;
const IV_BYTES = 12;

export type EncryptedGoogleCredential = {
  encryptedRefreshToken: string;
  encryptionIv: string;
  encryptionVersion: 1;
};

function decodeEncryptionKey(encodedKey: string) {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("Google token encryption is not configured correctly.");
  }
  return key;
}

export function encryptGoogleRefreshToken(
  refreshToken: string,
  encodedKey: string,
): EncryptedGoogleCredential {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, decodeEncryptionKey(encodedKey), iv);
  const ciphertext = Buffer.concat([
    cipher.update(refreshToken, "utf8"),
    cipher.final(),
  ]);
  const encryptedWithTag = Buffer.concat([ciphertext, cipher.getAuthTag()]);

  return {
    encryptedRefreshToken: encryptedWithTag.toString("base64"),
    encryptionIv: iv.toString("base64"),
    encryptionVersion: 1,
  };
}

export function decryptGoogleRefreshToken(
  credential: EncryptedGoogleCredential,
  encodedKey: string,
) {
  if (credential.encryptionVersion !== 1) {
    throw new Error("Unsupported Google credential encryption version.");
  }

  const encryptedWithTag = Buffer.from(
    credential.encryptedRefreshToken,
    "base64",
  );
  if (encryptedWithTag.length <= AUTH_TAG_BYTES) {
    throw new Error("Stored Google credential is invalid.");
  }

  const ciphertext = encryptedWithTag.subarray(0, -AUTH_TAG_BYTES);
  const authTag = encryptedWithTag.subarray(-AUTH_TAG_BYTES);
  const decipher = createDecipheriv(
    ALGORITHM,
    decodeEncryptionKey(encodedKey),
    Buffer.from(credential.encryptionIv, "base64"),
  );
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}
