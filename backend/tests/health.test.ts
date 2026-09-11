import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";

const testConfig: Env = {
  NODE_ENV: "test",
  PORT: 3_000,
  DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
  LOG_LEVEL: "silent",
  AUTH_SESSION_TTL_HOURS: 168,
};

test("GET /health returns the service status", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
});

test("GET /health/ready reports a reachable database", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());
  app.db.query = (async () => ({ rows: [{ "?column?": 1 }], rowCount: 1 })) as unknown as
    typeof app.db.query;

  const response = await app.inject({ method: "GET", url: "/health/ready" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", database: "ok" });
});

test("GET /health/ready reports 503 when the database is unavailable", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());
  app.db.query = (async () => {
    throw new Error("connection refused");
  }) as unknown as typeof app.db.query;

  const response = await app.inject({ method: "GET", url: "/health/ready" });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: "unavailable", database: "unavailable" });
});
