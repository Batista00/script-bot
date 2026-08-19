import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";
import { sessionCookieName } from "../src/modules/auth/auth.cookie.js";
import type { BusinessRole } from "../src/modules/memberships/memberships.types.js";
import {
  businessA, fulfillmentNow, itemA, orderA,
} from "./support/fulfillments-memory.js";

const userId = "5c4c1cf0-bcc5-44de-bb63-2e8aeb8cb576";
const membershipId = "3939b80f-2613-4a4d-8ac7-f3fe5924e406";
const fulfillmentId = "7338c08f-4186-43eb-90f5-22f8e3d952c0";
const authHeaders = { cookie: `${sessionCookieName}=test-session` };
const config: Env = {
  NODE_ENV: "test", PORT: 3000,
  DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
  LOG_LEVEL: "silent", AUTH_SESSION_TTL_HOURS: 168,
};

async function buildRoleApp(role: BusinessRole) {
  const app = await buildApp(config);
  app.authService.authenticate = async () => ({
    id: userId, email: `${role}@example.com`, name: role, status: "active",
    createdAt: fulfillmentNow, updatedAt: fulfillmentNow,
  });
  app.membershipsRepository.findByBusinessAndUser = async () => ({
    id: membershipId, businessId: businessA, userId, role,
    createdAt: fulfillmentNow, updatedAt: fulfillmentNow,
  });
  app.db.query = (async () => ({ rows: [], rowCount: 0 })) as unknown as typeof app.db.query;
  app.db.connect = (async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => undefined,
  })) as unknown as typeof app.db.connect;
  return app;
}

test("operator can read and sync fulfillments but cannot retry", async (t) => {
  const app = await buildRoleApp("operator");
  t.after(async () => app.close());
  const list = await app.inject({
    method: "GET", url: `/businesses/${businessA}/orders/${orderA}/fulfillments`,
    headers: authHeaders,
  });
  const sync = await app.inject({
    method: "POST", url: `/businesses/${businessA}/fulfillments/${fulfillmentId}/sync-status`,
    headers: authHeaders,
  });
  const retry = await app.inject({
    method: "POST", url: `/businesses/${businessA}/fulfillments/${fulfillmentId}/retry`,
    headers: authHeaders,
  });
  assert.equal(list.statusCode, 200);
  assert.equal(sync.statusCode, 404);
  assert.equal(sync.json().error.code, "FULFILLMENT_NOT_FOUND");
  assert.equal(retry.statusCode, 403);
  assert.equal(retry.json().error.code, "INSUFFICIENT_BUSINESS_ROLE");
});

test("owner/admin pass retry guard and caller cannot select provider fields", async (t) => {
  for (const role of ["owner", "admin"] as const) {
    const app = await buildRoleApp(role);
    t.after(async () => app.close());
    const retry = await app.inject({
      method: "POST", url: `/businesses/${businessA}/fulfillments/${fulfillmentId}/retry`,
      headers: authHeaders,
    });
    assert.equal(retry.statusCode, 404);
    assert.equal(retry.json().error.code, "FULFILLMENT_NOT_FOUND");
    const dispatch = await app.inject({
      method: "POST", url: `/businesses/${businessA}/orders/${orderA}/fulfillments`,
      headers: authHeaders,
      payload: {
        orderItemId: itemA, input: { link: "https://instagram.com/example" },
        providerServiceId: fulfillmentId, providerKey: "smm_raja", quantity: 999,
      },
    });
    assert.equal(dispatch.statusCode, 404);
    assert.equal(dispatch.json().error.code, "ORDER_NOT_FOUND");
  }
});
