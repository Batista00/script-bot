import assert from "node:assert/strict";
import { test } from "node:test";

import { createLoggerOptions } from "../src/core/logger/logger.js";
import {
  generateApiCredentialToken,
  hashApiCredentialToken,
} from "../src/modules/api-credentials/api-credentials.crypto.js";
import { ApiCredentialsService } from "../src/modules/api-credentials/api-credentials.service.js";
import { MachineAuthService } from "../src/modules/machine-auth/machine-auth.service.js";
import { MemoryApiCredentialsRepository } from "./support/api-credentials-memory.js";

const businessA = "1b6d119f-b7c9-4f6e-b203-35798da9f32b";

test("API credential token has 256-bit randomness format and only its SHA-256 hash is stored", async () => {
  const generated = new Set(Array.from({ length: 20 }, generateApiCredentialToken));
  assert.equal(generated.size, 20);
  assert.ok([...generated].every((token) => /^bw_[A-Za-z0-9_-]{43}$/.test(token)));

  const repository = new MemoryApiCredentialsRepository();
  const service = new ApiCredentialsService(repository);
  const result = await service.create(businessA, { name: "  Typebot Principal  " });
  const stored = repository.credentials[0]!;

  assert.equal(result.credential.name, "Typebot Principal");
  assert.equal(result.token.startsWith("bw_"), true);
  assert.equal(stored.tokenHash, hashApiCredentialToken(result.token));
  assert.equal(stored.tokenHash.includes(result.token), false);
  assert.equal(JSON.stringify(result.credential).includes("tokenHash"), false);
  assert.equal(JSON.stringify(await service.list(businessA)).includes(result.token), false);
  assert.equal(JSON.stringify(await service.getById(businessA, stored.id)).includes("tokenHash"), false);
});

test("machine authentication accepts only the exact active credential", async () => {
  const repository = new MemoryApiCredentialsRepository();
  const credentials = new ApiCredentialsService(repository, () =>
    "bw_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789");
  const created = await credentials.create(businessA, { name: "Typebot" });
  const machine = new MachineAuthService(repository);

  assert.deepEqual(await machine.authenticate(created.token), {
    credentialId: created.credential.id,
    businessId: businessA,
    credentialName: "Typebot",
  });
  assert.equal(await machine.authenticate("bw_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), null);
  await credentials.update(businessA, created.credential.id, { status: "inactive" });
  assert.equal(await machine.authenticate(created.token), null);
});

test("logger redacts machine Authorization and human Cookie headers", () => {
  const options = createLoggerOptions("info");
  assert.deepEqual(options.redact.paths.sort(), [
    "req.headers.authorization", "req.headers.cookie",
  ]);
});
