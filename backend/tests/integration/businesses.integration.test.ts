import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { buildApp } from "../../src/app.js";
import { createInitialOwner } from "../../src/cli/bootstrap-owner.js";
import type { Env } from "../../src/config/env.js";
import { PostgresBusinessesRepository } from "../../src/modules/businesses/businesses.repository.js";
import type { Business } from "../../src/modules/businesses/businesses.types.js";
import { PostgresMembershipsRepository } from "../../src/modules/memberships/memberships.repository.js";
import { PostgresUsersRepository } from "../../src/modules/users/users.repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test(
  "bootstrap and businesses flow against PostgreSQL",
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
      AUTH_SESSION_TTL_HOURS: 168,
    };
    const app = await buildApp(config);
    const businesses = new PostgresBusinessesRepository(app.db);
    const users = new PostgresUsersRepository(app.db);
    const memberships = new PostgresMembershipsRepository(app.db);
    let createdId: string | undefined;
    let seedBusinessId: string | undefined;
    let userId: string | undefined;

    t.after(async () => {
      if (userId) {
        await app.db.query("DELETE FROM users WHERE id = $1", [userId]);
      }
      if (createdId) {
        await app.db.query("DELETE FROM businesses WHERE id = $1", [createdId]);
      }
      if (seedBusinessId) {
        await app.db.query("DELETE FROM businesses WHERE id = $1", [seedBusinessId]);
      }
      await app.close();
    });

    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `integration-${unique}@example.com`;
    const password = "integration-password";
    const bootstrap = await createInitialOwner(
      app.db,
      { businesses, users, memberships },
      {
        businessName: `Seed ${unique}`,
        ownerName: "Integration Owner",
        ownerEmail: email,
        ownerPassword: password,
      },
    );
    seedBusinessId = bootstrap.business.id;
    userId = bootstrap.user.id;
    assert.equal(bootstrap.membership.role, "owner");

    const businessesBeforeRetry = await app.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM businesses",
    );
    await assert.rejects(
      createInitialOwner(
        app.db,
        { businesses, users, memberships },
        {
          businessName: `Rejected ${unique}`,
          ownerName: "Another Owner",
          ownerEmail: `another-${email}`,
          ownerPassword: password,
        },
      ),
      new Error("Bootstrap refused: system already initialized"),
    );
    const businessesAfterRetry = await app.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM businesses",
    );
    assert.equal(
      businessesAfterRetry.rows[0]?.count,
      businessesBeforeRetry.rows[0]?.count,
    );

    const loginResponse = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    assert.equal(loginResponse.statusCode, 200);
    const setCookie = loginResponse.headers["set-cookie"];
    const serializedCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(serializedCookie);
    const cookie = serializedCookie.split(";", 1)[0];

    const createResponse = await app.inject({
      method: "POST",
      url: "/businesses",
      headers: { cookie },
      payload: { name: `Integration Test ${Date.now()}` },
    });
    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json<Business>();
    createdId = created.id;
    assert.equal(created.status, "active");

    const listResponse = await app.inject({
      method: "GET",
      url: "/businesses",
      headers: { cookie },
    });
    assert.equal(listResponse.statusCode, 200);
    assert.ok(listResponse.json<Business[]>().some((business) => business.id === createdId));

    const getResponse = await app.inject({
      method: "GET",
      url: `/businesses/${createdId}`,
      headers: { cookie },
    });
    assert.equal(getResponse.statusCode, 200);
    assert.equal(getResponse.json<Business>().id, createdId);

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/businesses/${createdId}`,
      headers: { cookie },
      payload: { name: "Integration Test Updated", status: "inactive" },
    });
    assert.equal(updateResponse.statusCode, 200);
    assert.equal(updateResponse.json<Business>().name, "Integration Test Updated");
    assert.equal(updateResponse.json<Business>().status, "inactive");

    const meResponse = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie },
    });
    assert.equal(meResponse.statusCode, 200);

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie },
    });
    assert.equal(logoutResponse.statusCode, 204);

    const invalidatedResponse = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie },
    });
    assert.equal(invalidatedResponse.statusCode, 401);
  },
);
