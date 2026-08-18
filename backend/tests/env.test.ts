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
});

test("loadEnv rejects a non-PostgreSQL database URL", () => {
  assert.throws(() => loadEnv({ DATABASE_URL: "https://example.com/database" }));
});

