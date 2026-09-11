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

test("an unknown route answers with the standard error envelope", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/does-not-exist" });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), {
    error: { code: "NOT_FOUND", message: "Route not found" },
  });
});

test("a payload over the body limit is reported as 413, not 500", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: "user@example.com", password: "x".repeat(40_000) },
  });

  assert.equal(response.statusCode, 413);
  assert.deepEqual(response.json(), {
    error: { code: "PAYLOAD_TOO_LARGE", message: "Request payload is too large" },
  });
});

test("an unsupported media type is reported as 415, not 500", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    headers: { "content-type": "application/xml" },
    payload: "<login/>",
  });

  assert.equal(response.statusCode, 415);
  assert.deepEqual(response.json(), {
    error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Unsupported media type" },
  });
});
