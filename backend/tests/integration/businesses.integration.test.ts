import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { buildApp } from "../../src/app.js";
import type { Env } from "../../src/config/env.js";
import type { Business } from "../../src/modules/businesses/businesses.types.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test(
  "businesses CRUD against PostgreSQL",
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

    const config: Env = {
      NODE_ENV: "test",
      PORT: 3_000,
      DATABASE_URL: testDatabaseUrl,
      LOG_LEVEL: "silent",
    };
    const app = await buildApp(config);
    let createdId: string | undefined;

    t.after(async () => {
      if (createdId) {
        await app.db.query("DELETE FROM businesses WHERE id = $1", [createdId]);
      }
      await app.close();
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/businesses",
      payload: { name: `Integration Test ${Date.now()}` },
    });
    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json<Business>();
    createdId = created.id;
    assert.equal(created.status, "active");

    const listResponse = await app.inject({ method: "GET", url: "/businesses" });
    assert.equal(listResponse.statusCode, 200);
    assert.ok(listResponse.json<Business[]>().some((business) => business.id === createdId));

    const getResponse = await app.inject({
      method: "GET",
      url: `/businesses/${createdId}`,
    });
    assert.equal(getResponse.statusCode, 200);
    assert.equal(getResponse.json<Business>().id, createdId);

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/businesses/${createdId}`,
      payload: { name: "Integration Test Updated", status: "inactive" },
    });
    assert.equal(updateResponse.statusCode, 200);
    assert.equal(updateResponse.json<Business>().name, "Integration Test Updated");
    assert.equal(updateResponse.json<Business>().status, "inactive");
  },
);

