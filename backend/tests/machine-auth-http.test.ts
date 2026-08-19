import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";
import { AppError } from "../src/core/errors/app-error.js";
import { hashApiCredentialToken } from "../src/modules/api-credentials/api-credentials.crypto.js";
import { sessionCookieName } from "../src/modules/auth/auth.cookie.js";
import type { BusinessRole } from "../src/modules/memberships/memberships.types.js";

const businessA = "1b6d119f-b7c9-4f6e-b203-35798da9f32b";
const credentialId = "bb3932fc-70e9-47fb-9b55-eabdd1c36665";
const userId = "5c4c1cf0-bcc5-44de-bb63-2e8aeb8cb576";
const membershipId = "3939b80f-2613-4a4d-8ac7-f3fe5924e406";
const categoryId = "bca3e535-c449-4ab3-8329-66b50c30dc26";
const now = "2026-08-19T12:00:00.000Z";
const token = "bw_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";
const config: Env = {
  NODE_ENV: "test", PORT: 3000,
  DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
  LOG_LEVEL: "silent", AUTH_SESSION_TTL_HOURS: 168,
};

async function appWithRole(role: BusinessRole, active = true) {
  const app = await buildApp(config);
  app.authService.authenticate = async (session) => {
    if (session !== "session") {
      throw new AppError("Authentication required", 401, "AUTHENTICATION_REQUIRED");
    }
    return {
      id: userId, email: `${role}@example.com`, name: role, status: "active" as const,
      createdAt: now, updatedAt: now,
    };
  };
  app.membershipsRepository.findByBusinessAndUser = async () => ({
    id: membershipId, businessId: businessA, userId, role, createdAt: now, updatedAt: now,
  });
  const credentialRow = {
    id: credentialId, business_id: businessA, name: "Typebot Principal",
    token_hash: hashApiCredentialToken(token), token_prefix: token.slice(0, 11),
    status: active ? "active" : "inactive", created_at: now, updated_at: now,
  };
  app.db.query = (async (sql: string, values?: unknown[]) => {
    if (sql.includes("INSERT INTO business_api_credentials")) {
      return { rows: [credentialRow], rowCount: 1 };
    }
    if (sql.includes("FROM business_api_credentials") && sql.includes("token_hash = $1")) {
      assert.equal(values?.[0], hashApiCredentialToken(token));
      return { rows: active ? [credentialRow] : [], rowCount: active ? 1 : 0 };
    }
    if (sql.includes("FROM business_api_credentials")) {
      return { rows: [credentialRow], rowCount: 1 };
    }
    if (sql.includes("FROM categories")) {
      assert.equal(values?.[0], businessA);
      return { rows: [{
        id: categoryId, business_id: businessA, name: "Instagram", status: "active",
        created_at: now, updated_at: now,
      }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }) as unknown as typeof app.db.query;
  return app;
}

test("owner/admin administer credentials; raw token is returned only on POST", async (t) => {
  for (const role of ["owner", "admin"] as const) {
    const app = await appWithRole(role);
    t.after(async () => app.close());
    const created = await app.inject({
      method: "POST", url: `/businesses/${businessA}/api-credentials`,
      headers: { cookie: `${sessionCookieName}=session` }, payload: { name: "Typebot Principal" },
    });
    assert.equal(created.statusCode, 201);
    assert.match(created.json().token, /^bw_/);
    assert.equal("tokenHash" in created.json().credential, false);
    const listed = await app.inject({
      method: "GET", url: `/businesses/${businessA}/api-credentials`,
      headers: { cookie: `${sessionCookieName}=session` },
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(JSON.stringify(listed.json()).includes("tokenHash"), false);
    assert.equal(JSON.stringify(listed.json()).includes(created.json().token), false);
  }
});

test("operator cannot administer API credentials", async (t) => {
  const app = await appWithRole("operator");
  t.after(async () => app.close());
  const response = await app.inject({
    method: "POST", url: `/businesses/${businessA}/api-credentials`,
    headers: { cookie: `${sessionCookieName}=session` }, payload: { name: "Typebot" },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "INSUFFICIENT_BUSINESS_ROLE");
});

test("Bot Gateway requires a valid active Bearer token and ignores human cookies", async (t) => {
  const app = await appWithRole("owner");
  t.after(async () => app.close());
  for (const headers of [
    {},
    { authorization: token },
    { authorization: `Basic ${token}` },
    { authorization: "Bearer" },
    { authorization: "Bearer bw_invalid" },
    { authorization: `Bearer bw_${"A".repeat(300)}` },
    { cookie: `${sessionCookieName}=session` },
  ]) {
    const response = await app.inject({ method: "GET", url: "/bot/v1/categories", headers });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "MACHINE_AUTHENTICATION_REQUIRED");
  }
  const valid = await app.inject({
    method: "GET", url: "/bot/v1/categories",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(valid.statusCode, 200);
  assert.deepEqual(valid.json(), [{ categoryId, name: "Instagram" }]);
  const noRetry = await app.inject({
    method: "POST",
    url: "/bot/v1/fulfillments/7338c08f-4186-43eb-90f5-22f8e3d952c0/retry",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(noRetry.statusCode, 404);
  const adminWithBearer = await app.inject({
    method: "GET", url: `/businesses/${businessA}/api-credentials`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(adminWithBearer.statusCode, 401);
});

test("inactive credential receives the same 401 as an invalid token", async (t) => {
  const app = await appWithRole("owner", false);
  t.after(async () => app.close());
  const response = await app.inject({
    method: "GET", url: "/bot/v1/categories",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "MACHINE_AUTHENTICATION_REQUIRED");
});
