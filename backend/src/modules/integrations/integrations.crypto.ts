import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import { AppError } from "../../core/errors/app-error.js";
import type { JsonObject } from "./integrations.types.js";

const algorithm = "aes-256-gcm";
const formatVersion = "v1";

function contextBytes(businessId: string, providerKey: string): Buffer {
  return Buffer.from(`${businessId}:${providerKey}`, "utf8");
}

export class IntegrationCredentialsCrypto {
  constructor(private readonly encodedKey?: string) {}

  encrypt(credentials: JsonObject, businessId: string, providerKey: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(algorithm, this.key(), iv);
    cipher.setAAD(contextBytes(businessId, providerKey));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(credentials), "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      formatVersion,
      iv.toString("base64"),
      authTag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(":");
  }

  decrypt(payload: string, businessId: string, providerKey: string): JsonObject {
    try {
      const [version, ivValue, tagValue, ciphertextValue, extra] = payload.split(":");
      if (
        version !== formatVersion || ivValue === undefined || tagValue === undefined ||
        ciphertextValue === undefined || extra !== undefined
      ) {
        throw new Error("Invalid encrypted credentials format");
      }
      const decipher = createDecipheriv(
        algorithm,
        this.key(),
        Buffer.from(ivValue, "base64"),
      );
      decipher.setAAD(contextBytes(businessId, providerKey));
      decipher.setAuthTag(Buffer.from(tagValue, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextValue, "base64")),
        decipher.final(),
      ]).toString("utf8");
      const parsed: unknown = JSON.parse(plaintext);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Credentials payload is not an object");
      }
      return parsed as JsonObject;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "Integration credentials could not be decrypted",
        500,
        "INTEGRATION_CREDENTIALS_INVALID",
      );
    }
  }

  private key(): Buffer {
    if (this.encodedKey === undefined) {
      throw new AppError(
        "Integrations encryption key is required",
        500,
        "INTEGRATIONS_ENCRYPTION_KEY_REQUIRED",
      );
    }
    const key = Buffer.from(this.encodedKey, "base64");
    if (key.length !== 32) {
      throw new AppError(
        "Integrations encryption key is invalid",
        500,
        "INTEGRATIONS_ENCRYPTION_KEY_INVALID",
      );
    }
    return key;
  }
}
