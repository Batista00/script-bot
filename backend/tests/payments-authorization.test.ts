import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";
import { sessionCookieName } from "../src/modules/auth/auth.cookie.js";
import type { BusinessRole } from "../src/modules/memberships/memberships.types.js";
import {
  paymentBusinessA,
  paymentMissingId,
  paymentNow,
} from "./support/payments-memory.js";

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
    createdAt: paymentNow, updatedAt: paymentNow,
  });
  app.membershipsRepository.findByBusinessAndUser = async () => ({
    id: membershipId, businessId: paymentBusinessA, userId, role,
    createdAt: paymentNow, updatedAt: paymentNow,
  });
  app.db.query = (async () => ({ rows: [] })) as unknown as typeof app.db.query;
  return app;
}

test("operator can initiate and read Payments through normal authorization", async (t) => {
  const app = await buildRoleApp("operator");
  t.after(async () => app.close());
  const create = await app.inject({
    method: "POST",
    url: `/businesses/${paymentBusinessA}/orders/${paymentMissingId}/payments`,
    headers: authHeaders,
    payload: { providerKey: "unregistered_provider" },
  });
  const list = await app.inject({
    method: "GET", url: `/businesses/${paymentBusinessA}/payments`, headers: authHeaders,
  });
  const byOrder = await app.inject({
    method: "GET",
    url: `/businesses/${paymentBusinessA}/orders/${paymentMissingId}/payments`,
    headers: authHeaders,
  });
  assert.equal(create.statusCode, 503);
  assert.equal(create.json().error.code, "PAYMENT_PROVIDER_NOT_AVAILABLE");
  assert.equal(list.statusCode, 200);
  assert.equal(byOrder.statusCode, 200);
});

test("caller amount and currency are removed from the Payment creation contract", async (t) => {
  const app = await buildRoleApp("owner");
  t.after(async () => app.close());
  const response = await app.inject({
    method: "POST",
    url: `/businesses/${paymentBusinessA}/orders/${paymentMissingId}/payments`,
    headers: authHeaders,
    payload: { providerKey: "unregistered_provider", amount: 1, currency: "USD" },
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, "PAYMENT_PROVIDER_NOT_AVAILABLE");
});

test("there is no manual Payment approval endpoint", async (t) => {
  const app = await buildRoleApp("owner");
  t.after(async () => app.close());
  const response = await app.inject({
    method: "POST",
    url: `/businesses/${paymentBusinessA}/payments/${paymentMissingId}/approve`,
    headers: authHeaders,
  });
  assert.equal(response.statusCode, 404);
});

test("invalid Payment and Order UUIDs are rejected", async (t) => {
  const app = await buildRoleApp("admin");
  t.after(async () => app.close());
  for (const request of [
    { method: "GET" as const, url: `/businesses/${paymentBusinessA}/payments/not-a-uuid` },
    {
      method: "POST" as const,
      url: `/businesses/${paymentBusinessA}/orders/not-a-uuid/payments`,
      payload: { providerKey: "mercado_pago" },
    },
  ]) {
    const response = await app.inject({ ...request, headers: authHeaders });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
  }
});

test("unauthenticated callers cannot read Payments", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());
  const response = await app.inject({
    method: "GET", url: `/businesses/${paymentBusinessA}/payments`,
  });
  assert.equal(response.statusCode, 401);
});
