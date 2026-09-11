import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";
import { hashApiCredentialToken } from "../src/modules/api-credentials/api-credentials.crypto.js";
import { AppError } from "../src/core/errors/app-error.js";

const businessA = "1b6d119f-b7c9-4f6e-b203-35798da9f32b";
const credentialId = "bb3932fc-70e9-47fb-9b55-eabdd1c36665";
const integrationId = "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68";
const now = "2026-08-19T12:00:00.000Z";
const token = "bw_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";
const otherToken = "bw_abcdefghijklmnopqrstuvwxyzABCDEFGH123456780";

function config(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: "test",
    PORT: 3_000,
    DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
    LOG_LEVEL: "silent",
    AUTH_SESSION_TTL_HOURS: 168,
    BOT_RATE_LIMIT_MAX: 2,
    BOT_RATE_LIMIT_WINDOW_SECONDS: 60,
    WEBHOOK_RATE_LIMIT_MAX: 2,
    WEBHOOK_RATE_LIMIT_WINDOW_SECONDS: 60,
    ...overrides,
  };
}

async function appWithCredential() {
  const app = await buildApp(config());
  const rowFor = (bearer: string, id: string) => ({
    id,
    business_id: businessA,
    name: "Public limits",
    token_hash: hashApiCredentialToken(bearer),
    token_prefix: bearer.slice(0, 11),
    status: "active",
    business_status: "active",
    created_at: now,
    updated_at: now,
  });
  const rows = [
    rowFor(token, credentialId),
    rowFor(otherToken, "0d5a6a53-8a53-4dd5-a0ef-6f9bf8a4e2a1"),
  ];
  app.db.query = (async (sql: string, values?: unknown[]) => {
    if (sql.includes("business_api_credentials") && sql.includes("token_hash = $1")) {
      const match = rows.filter((row) => row.token_hash === values?.[0]);
      return { rows: match, rowCount: match.length };
    }
    return { rows: [], rowCount: 0 };
  }) as unknown as typeof app.db.query;
  return app;
}

test("the Bot Gateway throttles each machine credential independently", async (t) => {
  const app = await appWithCredential();
  t.after(async () => app.close());

  const call = (bearer: string) => app.inject({
    method: "GET",
    url: "/bot/v1/categories",
    headers: { authorization: `Bearer ${bearer}` },
  });

  assert.equal((await call(token)).statusCode, 200);
  assert.equal((await call(token)).statusCode, 200);

  const throttled = await call(token);
  assert.equal(throttled.statusCode, 429);
  assert.equal(throttled.json().error.code, "TOO_MANY_REQUESTS");
  assert.ok(Number(throttled.headers["retry-after"]) >= 1);

  // Another credential has its own bucket.
  assert.equal((await call(otherToken)).statusCode, 200);

  // Human routes are not affected by the machine limiter.
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
});

test("the public Mercado Pago webhook is throttled per client address", async (t) => {
  const app = await buildApp(config());
  t.after(async () => app.close());
  // No integration is configured, so an allowed request stops at the handler
  // lookup while the limiter still counts it.
  app.db.query = (async () => ({ rows: [], rowCount: 0 })) as unknown as typeof app.db.query;

  const call = (address: string) => app.inject({
    method: "POST",
    url: `/webhooks/mercado-pago/${integrationId}?data.id=123&type=payment`,
    remoteAddress: address,
    payload: {},
  });

  assert.equal((await call("203.0.113.7")).statusCode, 404);
  assert.equal((await call("203.0.113.7")).statusCode, 404);

  const throttled = await call("203.0.113.7");
  assert.equal(throttled.statusCode, 429);
  assert.equal(throttled.json().error.code, "TOO_MANY_REQUESTS");
  assert.ok(Number(throttled.headers["retry-after"]) >= 1);

  // A different address keeps its own budget.
  assert.equal((await call("203.0.113.8")).statusCode, 404);
});

test("login keeps its own dedicated limit and message", async (t) => {
  const app = await buildApp(config({
    BOT_RATE_LIMIT_MAX: 100,
    WEBHOOK_RATE_LIMIT_MAX: 100,
    AUTH_LOGIN_RATE_LIMIT_MAX: 2,
    AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: 60,
  }));
  t.after(async () => app.close());
  app.authService.login = async () => {
    throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
  };

  const call = () => app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: "user@example.com", password: "whatever" },
  });
  assert.equal((await call()).statusCode, 401);
  assert.equal((await call()).statusCode, 401);
  const throttled = await call();
  assert.equal(throttled.statusCode, 429);
  assert.equal(throttled.json().error.code, "TOO_MANY_LOGIN_ATTEMPTS");
});
