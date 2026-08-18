import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";
import { sessionCookieName } from "../src/modules/auth/auth.cookie.js";
import type { BusinessRole } from "../src/modules/memberships/memberships.types.js";
import { businessA, missingId, now } from "./support/orders-memory.js";

const userId = "46f5476a-c7e9-403f-9fff-fc3bb234c8b6";
const membershipId = "273676c0-da1f-47d4-a0a7-15624760233b";
const authHeaders = { cookie: `${sessionCookieName}=test-session` };
const testConfig: Env = {
  NODE_ENV: "test", PORT: 3_000,
  DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
  LOG_LEVEL: "silent", AUTH_SESSION_TTL_HOURS: 168,
};

async function buildRoleApp(role: BusinessRole) {
  const app = await buildApp(testConfig);
  app.authService.authenticate = async () => ({
    id: userId, email: `${role}@example.com`, name: role, status: "active",
    createdAt: now, updatedAt: now,
  });
  app.membershipsRepository.findByBusinessAndUser = async () => ({
    id: membershipId, businessId: businessA, userId, role, createdAt: now, updatedAt: now,
  });
  app.db.query = (async () => ({ rows: [] })) as unknown as typeof app.db.query;
  const client = {
    query: async () => ({ rows: [] }),
    release: () => undefined,
  };
  (app.db as unknown as { connect: () => Promise<typeof client> }).connect = async () => client;
  return app;
}

test("operator can create and read orders but cannot cancel", async (t) => {
  const app = await buildRoleApp("operator");
  t.after(async () => app.close());
  const create = await app.inject({
    method: "POST", url: `/businesses/${businessA}/orders`, headers: authHeaders,
    payload: { quoteId: missingId },
  });
  const list = await app.inject({
    method: "GET", url: `/businesses/${businessA}/orders`, headers: authHeaders,
  });
  const cancel = await app.inject({
    method: "POST", url: `/businesses/${businessA}/orders/${missingId}/cancel`,
    headers: authHeaders,
  });
  assert.equal(create.statusCode, 404);
  assert.equal(list.statusCode, 200);
  assert.equal(cancel.statusCode, 403);
});

for (const role of ["owner", "admin"] as const) {
  test(`${role} can reach explicit order cancellation`, async (t) => {
    const app = await buildRoleApp(role);
    t.after(async () => app.close());
    const response = await app.inject({
      method: "POST", url: `/businesses/${businessA}/orders/${missingId}/cancel`,
      headers: authHeaders,
    });
    assert.equal(response.statusCode, 404);
  });
}

test("invalid order UUID is rejected", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());
  const response = await app.inject({
    method: "GET", url: `/businesses/${businessA}/orders/not-a-uuid`,
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "INVALID_REQUEST");
});
