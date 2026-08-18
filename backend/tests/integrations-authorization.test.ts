import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";
import { sessionCookieName } from "../src/modules/auth/auth.cookie.js";
import type { BusinessRole } from "../src/modules/memberships/memberships.types.js";

const businessId = "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68";
const integrationId = "60878fd4-9a90-4f74-8905-d736c8b6ea11";
const userId = "46f5476a-c7e9-403f-9fff-fc3bb234c8b6";
const membershipId = "273676c0-da1f-47d4-a0a7-15624760233b";
const now = "2026-08-18T12:00:00.000Z";
const authHeaders = { cookie: `${sessionCookieName}=test-session` };
const testConfig: Env = {
  NODE_ENV: "test", PORT: 3_000,
  DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
  LOG_LEVEL: "silent", AUTH_SESSION_TTL_HOURS: 168,
  INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 13).toString("base64"),
};

const integrationRow = {
  id: integrationId,
  business_id: businessId,
  provider_key: "provider_one",
  status: "active",
  config: { sandbox: true },
  credentials_encrypted: "v1:encrypted-value-never-returned",
  created_at: now,
  updated_at: now,
};

async function buildRoleApp(role: BusinessRole, withRecord = true) {
  const app = await buildApp(testConfig);
  app.authService.authenticate = async () => ({
    id: userId, email: `${role}@example.com`, name: role, status: "active",
    createdAt: now, updatedAt: now,
  });
  app.membershipsRepository.findByBusinessAndUser = async () => ({
    id: membershipId, businessId, userId, role, createdAt: now, updatedAt: now,
  });
  app.db.query = (async () => ({ rows: withRecord ? [integrationRow] : [] })) as unknown as
    typeof app.db.query;
  return app;
}

for (const role of ["owner", "admin"] as const) {
  test(`${role} can create and read integrations without receiving credentials`, async (t) => {
    const app = await buildRoleApp(role);
    t.after(async () => app.close());
    const create = await app.inject({
      method: "POST",
      url: `/businesses/${businessId}/integrations`,
      headers: authHeaders,
      payload: {
        providerKey: "provider_one",
        config: { sandbox: true },
        credentials: { accessToken: "must-not-be-returned" },
      },
    });
    const list = await app.inject({
      method: "GET", url: `/businesses/${businessId}/integrations`, headers: authHeaders,
    });
    assert.equal(create.statusCode, 201);
    assert.equal(list.statusCode, 200);
    for (const body of [create.body, list.body]) {
      assert.equal(body.includes("credentials"), false);
      assert.equal(body.includes("must-not-be-returned"), false);
      assert.equal(body.includes("encrypted-value-never-returned"), false);
    }
  });
}

test("operator cannot administer integrations", async (t) => {
  const app = await buildRoleApp("operator");
  t.after(async () => app.close());
  for (const request of [
    { method: "GET" as const, url: `/businesses/${businessId}/integrations` },
    {
      method: "POST" as const,
      url: `/businesses/${businessId}/integrations`,
      payload: { providerKey: "provider_one", credentials: { token: "secret" } },
    },
  ]) {
    const response = await app.inject({ ...request, headers: authHeaders });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "INSUFFICIENT_BUSINESS_ROLE");
  }
});

test("invalid integration status and UUID are rejected", async (t) => {
  const app = await buildRoleApp("owner");
  t.after(async () => app.close());
  const invalidStatus = await app.inject({
    method: "PATCH",
    url: `/businesses/${businessId}/integrations/${integrationId}`,
    headers: authHeaders,
    payload: { status: "deleted" },
  });
  const invalidUuid = await app.inject({
    method: "GET",
    url: `/businesses/${businessId}/integrations/not-a-uuid`,
    headers: authHeaders,
  });
  assert.equal(invalidStatus.statusCode, 400);
  assert.equal(invalidUuid.statusCode, 400);
  assert.equal(invalidStatus.json().error.code, "INVALID_REQUEST");
  assert.equal(invalidUuid.json().error.code, "INVALID_REQUEST");
});

test("missing integration returns 404 through HTTP", async (t) => {
  const app = await buildRoleApp("admin", false);
  t.after(async () => app.close());
  const response = await app.inject({
    method: "GET",
    url: `/businesses/${businessId}/integrations/${integrationId}`,
    headers: authHeaders,
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, "INTEGRATION_NOT_FOUND");
});
