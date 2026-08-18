import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { AppError } from "../src/core/errors/app-error.js";
import { IntegrationCredentialsCrypto } from "../src/modules/integrations/integrations.crypto.js";
import { IntegrationsService } from "../src/modules/integrations/integrations.service.js";
import {
  type BusinessIntegrationRecord,
  type IntegrationListOptions,
  type IntegrationPersistenceInput,
  IntegrationProviderConflictError,
  type IntegrationsRepository,
} from "../src/modules/integrations/integrations.types.js";

const businessA = "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68";
const businessB = "9d1b85eb-ecbf-479c-838f-80e53e98c9a8";
const missingId = "60878fd4-9a90-4f74-8905-d736c8b6ea11";
const now = "2026-08-18T12:00:00.000Z";
const encryptionKey = Buffer.alloc(32, 11).toString("base64");

function clone<T>(value: T): T { return structuredClone(value); }

class MemoryIntegrationsRepository implements IntegrationsRepository {
  readonly records: BusinessIntegrationRecord[] = [];

  async create(
    businessId: string,
    input: IntegrationPersistenceInput,
  ): Promise<BusinessIntegrationRecord> {
    if (this.records.some((record) =>
      record.businessId === businessId && record.providerKey === input.providerKey)) {
      throw new IntegrationProviderConflictError();
    }
    const record = {
      id: randomUUID(), businessId, ...clone(input), createdAt: now, updatedAt: now,
    };
    this.records.push(record);
    return clone(record);
  }

  async list(
    businessId: string,
    options: IntegrationListOptions,
  ): Promise<BusinessIntegrationRecord[]> {
    return this.records.filter((record) => record.businessId === businessId &&
      (options.status === undefined || record.status === options.status) &&
      (options.providerKey === undefined || record.providerKey === options.providerKey))
      .slice(options.offset, options.offset + options.limit).map(clone);
  }

  async findById(
    businessId: string,
    integrationId: string,
  ): Promise<BusinessIntegrationRecord | null> {
    const record = this.records.find((item) =>
      item.businessId === businessId && item.id === integrationId);
    return record ? clone(record) : null;
  }

  async findByProviderKey(
    businessId: string,
    providerKey: string,
  ): Promise<BusinessIntegrationRecord | null> {
    const record = this.records.find((item) =>
      item.businessId === businessId && item.providerKey === providerKey);
    return record ? clone(record) : null;
  }

  async update(
    businessId: string,
    integrationId: string,
    input: IntegrationPersistenceInput,
  ): Promise<BusinessIntegrationRecord | null> {
    const index = this.records.findIndex((record) =>
      record.businessId === businessId && record.id === integrationId);
    const existing = this.records[index];
    if (!existing) return null;
    const updated = { ...existing, ...clone(input), updatedAt: now };
    this.records[index] = updated;
    return clone(updated);
  }
}

function createService() {
  const repository = new MemoryIntegrationsRepository();
  const crypto = new IntegrationCredentialsCrypto(encryptionKey);
  return { repository, service: new IntegrationsService(repository, crypto) };
}

function hasAppError(code: string, statusCode: number): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === code &&
    error.statusCode === statusCode;
}

test("create normalizes provider, encrypts credentials, and returns no secrets", async () => {
  const { repository, service } = createService();
  const created = await service.create(businessA, {
    providerKey: "  PROVIDER_ONE  ",
    config: { sandbox: true },
    credentials: { accessToken: "visible-only-before-encryption" },
  });
  const stored = repository.records[0];
  assert.ok(stored);
  assert.equal(created.providerKey, "provider_one");
  assert.deepEqual(created.config, { sandbox: true });
  assert.equal("credentials" in created, false);
  assert.equal("credentialsEncrypted" in created, false);
  assert.match(stored.credentialsEncrypted, /^v1:/);
  assert.equal(stored.credentialsEncrypted.includes("visible-only-before-encryption"), false);
});

test("internal access decrypts only an active integration", async () => {
  const { service } = createService();
  const created = await service.create(businessA, {
    providerKey: "provider_one",
    credentials: { accessToken: "internal-secret" },
  });
  const active = await service.getActiveIntegration(businessA, "PROVIDER_ONE");
  assert.deepEqual(active?.credentials, { accessToken: "internal-secret" });
  await service.update(businessA, created.id, { status: "inactive" });
  assert.equal(await service.getActiveIntegration(businessA, "provider_one"), null);
});

test("public get and list never expose encrypted or decrypted credentials", async () => {
  const { service } = createService();
  const created = await service.create(businessA, {
    providerKey: "provider_one",
    credentials: { accessToken: "secret" },
  });
  for (const value of [
    await service.getById(businessA, created.id),
    ...(await service.list(businessA, { limit: 50, offset: 0 })),
  ]) {
    assert.equal("credentials" in value, false);
    assert.equal("credentialsEncrypted" in value, false);
    assert.equal(JSON.stringify(value).includes("secret"), false);
  }
});

test("PATCH without credentials preserves ciphertext and PATCH with credentials replaces it", async () => {
  const { repository, service } = createService();
  const created = await service.create(businessA, {
    providerKey: "provider_one",
    credentials: { accessToken: "first-secret" },
  });
  const firstCiphertext = repository.records[0]?.credentialsEncrypted;
  await service.update(businessA, created.id, { config: { sandbox: true } });
  assert.equal(repository.records[0]?.credentialsEncrypted, firstCiphertext);

  await service.update(businessA, created.id, {
    credentials: { accessToken: "second-secret" },
  });
  assert.notEqual(repository.records[0]?.credentialsEncrypted, firstCiphertext);
  assert.deepEqual(
    (await service.getActiveIntegration(businessA, "provider_one"))?.credentials,
    { accessToken: "second-secret" },
  );
});

test("duplicate provider conflicts within a business but is allowed in another", async () => {
  const { service } = createService();
  const input = { providerKey: "provider_one", credentials: { token: "secret" } };
  await service.create(businessA, input);
  await assert.rejects(
    service.create(businessA, input),
    hasAppError("INTEGRATION_PROVIDER_ALREADY_EXISTS", 409),
  );
  const other = await service.create(businessB, input);
  assert.equal(other.businessId, businessB);
});

test("Business A cannot access or update an integration from Business B", async () => {
  const { service } = createService();
  const created = await service.create(businessB, {
    providerKey: "provider_one", credentials: { token: "secret" },
  });
  await assert.rejects(
    service.getById(businessA, created.id),
    hasAppError("INTEGRATION_NOT_FOUND", 404),
  );
  await assert.rejects(
    service.update(businessA, created.id, { status: "inactive" }),
    hasAppError("INTEGRATION_NOT_FOUND", 404),
  );
});

test("config rejects secret-like fields", async () => {
  const { service } = createService();
  await assert.rejects(
    service.create(businessA, {
      providerKey: "provider_one",
      config: { nested: { accessToken: "wrong-place" } },
      credentials: { token: "correct-place" },
    }),
    hasAppError("INTEGRATION_CONFIG_CONTAINS_SECRET", 400),
  );
});

test("missing integration returns a controlled 404", async () => {
  const { service } = createService();
  await assert.rejects(
    service.getById(businessA, missingId),
    hasAppError("INTEGRATION_NOT_FOUND", 404),
  );
});
