import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { createDatabasePool } from "../../src/core/database/database.js";
import { AppError } from "../../src/core/errors/app-error.js";
import { PostgresBusinessesRepository } from "../../src/modules/businesses/businesses.repository.js";
import { IntegrationCredentialsCrypto } from "../../src/modules/integrations/integrations.crypto.js";
import { PostgresIntegrationsRepository } from "../../src/modules/integrations/integrations.repository.js";
import { IntegrationsService } from "../../src/modules/integrations/integrations.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test(
  "business integrations encryption and isolation against PostgreSQL",
  { skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is not configured" },
  async (t) => {
    if (!testDatabaseUrl) return;
    await runner({
      databaseUrl: testDatabaseUrl,
      direction: "up",
      dir: "migrations",
      migrationsTable: "pgmigrations",
      count: Infinity,
      log: () => undefined,
    });
    const db = createDatabasePool(testDatabaseUrl);
    const businesses = new PostgresBusinessesRepository(db);
    const repository = new PostgresIntegrationsRepository(db);
    const service = new IntegrationsService(
      repository,
      new IntegrationCredentialsCrypto(Buffer.alloc(32, 19).toString("base64")),
    );
    const businessIds: string[] = [];
    t.after(async () => {
      for (const businessId of businessIds) {
        await db.query("DELETE FROM businesses WHERE id = $1", [businessId]);
      }
      await db.end();
    });

    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const businessA = await businesses.create(`Integrations A ${unique}`);
    const businessB = await businesses.create(`Integrations B ${unique}`);
    businessIds.push(businessA.id, businessB.id);
    const secret = `postgres-secret-${unique}`;
    const createdA = await service.create(businessA.id, {
      providerKey: "  PROVIDER_ONE  ",
      config: { sandbox: true },
      credentials: { accessToken: secret },
    });
    assert.equal(createdA.providerKey, "provider_one");
    assert.equal("credentials" in createdA, false);
    assert.equal("credentialsEncrypted" in createdA, false);

    const stored = await db.query<{
      config: { sandbox: boolean };
      credentials_encrypted: string;
    }>(
      `SELECT config, credentials_encrypted FROM business_integrations
       WHERE business_id = $1 AND id = $2`,
      [businessA.id, createdA.id],
    );
    assert.deepEqual(stored.rows[0]?.config, { sandbox: true });
    assert.match(stored.rows[0]?.credentials_encrypted ?? "", /^v1:/);
    assert.equal(stored.rows[0]?.credentials_encrypted.includes(secret), false);
    assert.deepEqual(
      (await service.getActiveIntegration(businessA.id, "provider_one"))?.credentials,
      { accessToken: secret },
    );

    await assert.rejects(
      service.create(businessA.id, {
        providerKey: "provider_one",
        credentials: { accessToken: "duplicate" },
      }),
      (error: unknown) => error instanceof AppError &&
        error.code === "INTEGRATION_PROVIDER_ALREADY_EXISTS",
    );
    const createdB = await service.create(businessB.id, {
      providerKey: "provider_one",
      credentials: { accessToken: "business-b-secret" },
    });
    assert.equal(createdB.businessId, businessB.id);
    await assert.rejects(
      service.getById(businessA.id, createdB.id),
      (error: unknown) => error instanceof AppError && error.code === "INTEGRATION_NOT_FOUND",
    );
    assert.equal(await repository.findById(businessB.id, createdA.id), null);
  },
);
