import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "../src/core/errors/app-error.js";
import { IntegrationCredentialsCrypto } from "../src/modules/integrations/integrations.crypto.js";

const key = Buffer.alloc(32, 7).toString("base64");
const businessId = "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68";

test("AES-256-GCM encrypts credentials and decrypts the original object", () => {
  const crypto = new IntegrationCredentialsCrypto(key);
  const encrypted = crypto.encrypt(
    { accessToken: "super-secret-token", nested: { account: 42 } },
    businessId,
    "provider_one",
  );
  assert.match(encrypted, /^v1:/);
  assert.equal(encrypted.includes("super-secret-token"), false);
  assert.deepEqual(crypto.decrypt(encrypted, businessId, "provider_one"), {
    accessToken: "super-secret-token",
    nested: { account: 42 },
  });
});

test("AES-GCM rejects ciphertext tampering and context swapping", () => {
  const crypto = new IntegrationCredentialsCrypto(key);
  const encrypted = crypto.encrypt({ apiKey: "secret" }, businessId, "provider_one");
  const parts = encrypted.split(":");
  const authTag = parts[2];
  assert.ok(authTag);
  parts[2] = `${authTag[0] === "A" ? "B" : "A"}${authTag.slice(1)}`;
  const tampered = parts.join(":");
  for (const operation of [
    () => crypto.decrypt(tampered, businessId, "provider_one"),
    () => crypto.decrypt(encrypted, businessId, "provider_two"),
  ]) {
    assert.throws(
      operation,
      (error: unknown) => error instanceof AppError &&
        error.code === "INTEGRATION_CREDENTIALS_INVALID",
    );
  }
});

test("encryption fails explicitly when the master key is unavailable", () => {
  const crypto = new IntegrationCredentialsCrypto();
  assert.throws(
    () => crypto.encrypt({ token: "secret" }, businessId, "provider_one"),
    (error: unknown) => error instanceof AppError &&
      error.code === "INTEGRATIONS_ENCRYPTION_KEY_REQUIRED",
  );
});
