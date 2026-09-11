import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { buildApp } from "../../src/app.js";
import type { Env } from "../../src/config/env.js";
import { createDatabasePool } from "../../src/core/database/database.js";
import { hashPassword } from "../../src/modules/auth/auth.crypto.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test(
  "session lifecycle and readiness against PostgreSQL",
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
    const config: Env = {
      NODE_ENV: "test",
      PORT: 3_000,
      DATABASE_URL: testDatabaseUrl,
      LOG_LEVEL: "silent",
      AUTH_SESSION_TTL_HOURS: 168,
    };
    const app = await buildApp(config);
    const businessIds: string[] = [];
    const emails: string[] = [];
    t.after(async () => {
      for (const businessId of businessIds) {
        await db.query("DELETE FROM businesses WHERE id = $1", [businessId]);
      }
      if (emails.length > 0) {
        await db.query("DELETE FROM users WHERE lower(email) = ANY($1::text[])", [
          emails.map((email) => email.toLowerCase()),
        ]);
      }
      await app.close();
      await db.end();
    });

    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.json(), { status: "ok", database: "ok" });

    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `sessions-${unique}@example.com`;
    const password = "integration-password";
    emails.push(email);
    const business = await db.query<{ id: string }>(
      "INSERT INTO businesses (name) VALUES ($1) RETURNING id",
      [`Sessions ${unique}`],
    );
    const businessId = business.rows[0]?.id;
    assert.ok(businessId);
    businessIds.push(businessId);
    const user = await db.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      [email, "Sessions Owner", await hashPassword(password)],
    );
    const userId = user.rows[0]?.id;
    assert.ok(userId);
    await db.query(
      `INSERT INTO business_memberships (business_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [businessId, userId],
    );

    const expired = await db.query<{ id: string }>(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() - interval '1 hour') RETURNING id`,
      [userId, "a".repeat(64)],
    );
    const expiredId = expired.rows[0]?.id;
    assert.ok(expiredId);

    const login = await app.inject({
      method: "POST", url: "/auth/login", payload: { email, password },
    });
    assert.equal(login.statusCode, 200, JSON.stringify(login.json()));

    const sessions = await db.query<{ id: string; token_hash: string; expired: boolean }>(
      `SELECT id, token_hash, expires_at <= now() AS expired FROM auth_sessions WHERE user_id = $1`,
      [userId],
    );
    assert.equal(sessions.rows.length, 1);
    assert.equal(sessions.rows[0]?.id === expiredId, false);
    assert.equal(sessions.rows[0]?.expired, false);
    assert.notEqual(sessions.rows[0]?.token_hash, "a".repeat(64));

    const header = login.headers["set-cookie"];
    const serialized = Array.isArray(header) ? header[0] : header;
    assert.ok(serialized);
    const cookie = serialized.split(";", 1)[0] ?? "";
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().businesses.length, 1);

    const logout = await app.inject({
      method: "POST", url: "/auth/logout", headers: { cookie },
    });
    assert.equal(logout.statusCode, 204);
    const revoked = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    assert.equal(revoked.statusCode, 401);
  },
);
