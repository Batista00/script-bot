import assert from "node:assert/strict";
import { test } from "node:test";

import { loadEnv } from "../src/config/env.js";

test("loadEnv applies safe defaults and parses PORT", () => {
  const env = loadEnv({
    DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
    PORT: "4321",
  });

  assert.equal(env.NODE_ENV, "development");
  assert.equal(env.PORT, 4321);
  assert.equal(env.LOG_LEVEL, "info");
  assert.equal(env.AUTH_SESSION_TTL_HOURS, 168);
  assert.equal(env.INTEGRATIONS_ENCRYPTION_KEY, undefined);
  assert.equal(env.PUBLIC_API_BASE_URL, undefined);
});

test("loadEnv validates the optional public API base URL", () => {
  const database = "postgresql://bot:test@localhost:5432/bot_whatsapp";
  assert.equal(loadEnv({
    DATABASE_URL: database,
    PUBLIC_API_BASE_URL: "https://api.example.com",
  }).PUBLIC_API_BASE_URL, "https://api.example.com");
  assert.equal(loadEnv({
    DATABASE_URL: database,
    PUBLIC_API_BASE_URL: "",
  }).PUBLIC_API_BASE_URL, undefined);
  assert.throws(() => loadEnv({
    DATABASE_URL: database,
    PUBLIC_API_BASE_URL: "not-a-url",
  }));
});

test("loadEnv rejects a non-PostgreSQL database URL", () => {
  assert.throws(() => loadEnv({ DATABASE_URL: "https://example.com/database" }));
});

test("loadEnv validates the optional integrations encryption key", () => {
  const key = Buffer.alloc(32, 17).toString("base64");
  assert.equal(loadEnv({
    DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
    INTEGRATIONS_ENCRYPTION_KEY: key,
  }).INTEGRATIONS_ENCRYPTION_KEY, key);
  assert.equal(loadEnv({
    DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
    INTEGRATIONS_ENCRYPTION_KEY: "",
  }).INTEGRATIONS_ENCRYPTION_KEY, undefined);
  assert.throws(() => loadEnv({
    DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
    INTEGRATIONS_ENCRYPTION_KEY: "not-a-valid-key",
  }));
});
