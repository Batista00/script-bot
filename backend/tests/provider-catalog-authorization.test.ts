import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";
import { sessionCookieName } from "../src/modules/auth/auth.cookie.js";
import type { BusinessRole } from "../src/modules/memberships/memberships.types.js";
import {
  catalogBusinessA,
  catalogIntegrationA,
  catalogNow,
  catalogProductA,
} from "./support/provider-catalog-memory.js";

const userId = "5c4c1cf0-bcc5-44de-bb63-2e8aeb8cb576";
const membershipId = "3939b80f-2613-4a4d-8ac7-f3fe5924e406";
const providerServiceId = "acdad7b8-eab5-44e8-a4d8-8ad5f9cfdd79";
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
    createdAt: catalogNow, updatedAt: catalogNow,
  });
  app.membershipsRepository.findByBusinessAndUser = async () => ({
    id: membershipId, businessId: catalogBusinessA, userId, role,
    createdAt: catalogNow, updatedAt: catalogNow,
  });
  app.db.query = (async () => ({ rows: [], rowCount: 0 })) as unknown as typeof app.db.query;
  return app;
}

test("operator can read Provider Services and mappings", async (t) => {
  const app = await buildRoleApp("operator");
  t.after(async () => app.close());
  const list = await app.inject({
    method: "GET",
    url: `/businesses/${catalogBusinessA}/provider-services`,
    headers: authHeaders,
  });
  const mapping = await app.inject({
    method: "GET",
    url: `/businesses/${catalogBusinessA}/products/${catalogProductA}/provider-mapping`,
    headers: authHeaders,
  });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json(), []);
  assert.equal(mapping.statusCode, 404);
  assert.equal(mapping.json().error.code, "PRODUCT_NOT_FOUND");
});

test("operator cannot sync or write provider mappings", async (t) => {
  const app = await buildRoleApp("operator");
  t.after(async () => app.close());
  for (const request of [
    {
      method: "POST" as const,
      url: `/businesses/${catalogBusinessA}/integrations/${catalogIntegrationA}/provider-services/sync`,
    },
    {
      method: "POST" as const,
      url: `/businesses/${catalogBusinessA}/products/${catalogProductA}/provider-mapping`,
      payload: { providerServiceId },
    },
    {
      method: "PATCH" as const,
      url: `/businesses/${catalogBusinessA}/products/${catalogProductA}/provider-mapping`,
      payload: { status: "inactive" },
    },
  ]) {
    const response = await app.inject({ ...request, headers: authHeaders });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "INSUFFICIENT_BUSINESS_ROLE");
  }
});

test("owner and admin pass the mapping write guard", async (t) => {
  for (const role of ["owner", "admin"] as const) {
    const app = await buildRoleApp(role);
    t.after(async () => app.close());
    const mapping = await app.inject({
      method: "POST",
      url: `/businesses/${catalogBusinessA}/products/${catalogProductA}/provider-mapping`,
      headers: authHeaders,
      payload: { providerServiceId },
    });
    const sync = await app.inject({
      method: "POST",
      url: `/businesses/${catalogBusinessA}/integrations/${catalogIntegrationA}/provider-services/sync`,
      headers: authHeaders,
    });
    assert.equal(mapping.statusCode, 404);
    assert.equal(mapping.json().error.code, "PRODUCT_NOT_FOUND");
    assert.equal(sync.statusCode, 404);
    assert.equal(sync.json().error.code, "INTEGRATION_NOT_FOUND");
  }
});
