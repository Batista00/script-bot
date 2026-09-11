import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";
import type { Pool } from "pg";

import { buildApp } from "../../src/app.js";
import type { Env } from "../../src/config/env.js";
import { createDatabasePool } from "../../src/core/database/database.js";
import { hashPassword } from "../../src/modules/auth/auth.crypto.js";
import { sessionCookieName } from "../../src/modules/auth/auth.cookie.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

interface SeededBusiness { businessId: string; ownerEmail: string }

async function seedBusiness(
  db: Pool,
  suffix: string,
  createdEmails: string[],
): Promise<SeededBusiness> {
  const business = await db.query<{ id: string }>(
    "INSERT INTO businesses (name) VALUES ($1) RETURNING id",
    [`Members ${suffix}`],
  );
  const businessId = business.rows[0]?.id;
  assert.ok(businessId);
  const ownerEmail = `owner-${suffix}@example.com`;
  const owner = await db.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [ownerEmail, "Members Owner", await hashPassword("integration-password")],
  );
  const ownerId = owner.rows[0]?.id;
  assert.ok(ownerId);
  createdEmails.push(ownerEmail);
  await db.query(
    `INSERT INTO business_memberships (business_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [businessId, ownerId],
  );
  return { businessId, ownerEmail };
}

test(
  "membership administration HTTP flow against PostgreSQL",
  { skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is not configured" },
  async (t) => {
    if (!testDatabaseUrl) return;
    await runner({
      databaseUrl: testDatabaseUrl,
      direction: "up",
      dir: "migrations",
      migrationsTable: "pgmigrations",
      count: Infinity,
      log: () => undefined,
    });
    const db = createDatabasePool(testDatabaseUrl);
    const config: Env = {
      NODE_ENV: "test",
      PORT: 3_000,
      DATABASE_URL: testDatabaseUrl,
      LOG_LEVEL: "silent",
      AUTH_SESSION_TTL_HOURS: 168,
    };
    const app = await buildApp(config);
    const businessIds: string[] = [];
    const createdEmails: string[] = [];
    t.after(async () => {
      for (const businessId of businessIds) {
        await db.query("DELETE FROM businesses WHERE id = $1", [businessId]);
      }
      if (createdEmails.length > 0) {
        await db.query("DELETE FROM users WHERE lower(email) = ANY($1::text[])", [
          createdEmails.map((email) => email.toLowerCase()),
        ]);
      }
      await app.close();
      await db.end();
    });

    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const primary = await seedBusiness(db, unique, createdEmails);
    const foreign = await seedBusiness(db, `${unique}-foreign`, createdEmails);
    businessIds.push(primary.businessId, foreign.businessId);

    async function login(email: string, password = "integration-password"): Promise<string> {
      const response = await app.inject({
        method: "POST", url: "/auth/login", payload: { email, password },
      });
      assert.equal(response.statusCode, 200, JSON.stringify(response.json()));
      const header = response.headers["set-cookie"];
      const serialized = Array.isArray(header) ? header[0] : header;
      assert.ok(serialized);
      return serialized.split(";", 1)[0] ?? "";
    }

    const ownerCookie = await login(primary.ownerEmail);
    const foreignCookie = await login(foreign.ownerEmail);
    const base = `/businesses/${primary.businessId}/memberships`;

    const initial = await app.inject({ method: "GET", url: base, headers: { cookie: ownerCookie } });
    assert.equal(initial.statusCode, 200);
    assert.equal(initial.json().length, 1);
    assert.equal(initial.json()[0].role, "owner");
    assert.equal(initial.json()[0].status, "active");
    assert.equal(initial.json()[0].user.email, primary.ownerEmail);
    assert.equal("businessStatus" in initial.json()[0], false);

    const foreignAttempt = await app.inject({
      method: "GET", url: base, headers: { cookie: foreignCookie },
    });
    assert.equal(foreignAttempt.statusCode, 404);

    // Create a brand new user with a membership
    const operatorEmail = `operator-${unique}@example.com`;
    createdEmails.push(operatorEmail);
    const createdOperator = await app.inject({
      method: "POST", url: base, headers: { cookie: ownerCookie },
      payload: { email: operatorEmail, role: "operator", name: "Nuevo Operador", password: "operator-password-1" },
    });
    assert.equal(createdOperator.statusCode, 201, JSON.stringify(createdOperator.json()));
    const operatorMembershipId = createdOperator.json().id;
    assert.equal(createdOperator.json().user.email, operatorEmail);
    const operatorCookie = await login(operatorEmail, "operator-password-1");

    // Attach an already existing account without duplicating the user
    const adminEmail = `admin-${unique}@example.com`;
    createdEmails.push(adminEmail);
    const createdAdmin = await app.inject({
      method: "POST", url: base, headers: { cookie: ownerCookie },
      payload: { email: adminEmail, role: "admin", name: "Admin Nuevo", password: "admin-password-1" },
    });
    assert.equal(createdAdmin.statusCode, 201);
    const usersWithEmail = await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM users WHERE lower(email) = $1",
      [adminEmail],
    );
    assert.equal(usersWithEmail.rows[0]?.count, 1);

    const duplicate = await app.inject({
      method: "POST", url: base, headers: { cookie: ownerCookie },
      payload: { email: adminEmail, role: "operator" },
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().error.code, "MEMBERSHIP_ALREADY_EXISTS");

    const shortPassword = await app.inject({
      method: "POST", url: base, headers: { cookie: ownerCookie },
      payload: { email: `x-${unique}@example.com`, role: "operator", name: "X", password: "short" },
    });
    assert.equal(shortPassword.statusCode, 400);
    assert.equal(shortPassword.json().error.code, "INVALID_USER_PASSWORD");

    // Operator cannot manage memberships
    const operatorAttempt = await app.inject({
      method: "GET", url: base, headers: { cookie: operatorCookie },
    });
    assert.equal(operatorAttempt.statusCode, 403);
    assert.equal(operatorAttempt.json().error.code, "INSUFFICIENT_BUSINESS_ROLE");

    // Role change and deactivation revoke access without deleting history
    const promoted = await app.inject({
      method: "PATCH", url: `${base}/${operatorMembershipId}`,
      headers: { cookie: ownerCookie }, payload: { role: "admin" },
    });
    assert.equal(promoted.statusCode, 200);
    assert.equal(promoted.json().role, "admin");

    const deactivated = await app.inject({
      method: "PATCH", url: `${base}/${operatorMembershipId}`,
      headers: { cookie: ownerCookie }, payload: { status: "inactive" },
    });
    assert.equal(deactivated.statusCode, 200);
    assert.equal(deactivated.json().status, "inactive");

    const revoked = await app.inject({
      method: "GET", url: `/businesses/${primary.businessId}`, headers: { cookie: operatorCookie },
    });
    assert.equal(revoked.statusCode, 404);
    const revokedMe = await app.inject({
      method: "GET", url: "/auth/me", headers: { cookie: operatorCookie },
    });
    assert.equal(revokedMe.statusCode, 200);
    assert.equal(revokedMe.json().businesses.length, 0);

    const reactivated = await app.inject({
      method: "PATCH", url: `${base}/${operatorMembershipId}`,
      headers: { cookie: ownerCookie }, payload: { status: "active" },
    });
    assert.equal(reactivated.statusCode, 200);
    const restored = await app.inject({
      method: "GET", url: `/businesses/${primary.businessId}`, headers: { cookie: operatorCookie },
    });
    assert.equal(restored.statusCode, 200);

    // Escalation rules
    const adminMembershipId = createdAdmin.json().id;
    const adminCookie = await login(adminEmail, "admin-password-1");
    const adminGrantsOwner = await app.inject({
      method: "PATCH", url: `${base}/${operatorMembershipId}`,
      headers: { cookie: adminCookie }, payload: { role: "owner" },
    });
    assert.equal(adminGrantsOwner.statusCode, 403);
    assert.equal(adminGrantsOwner.json().error.code, "MEMBERSHIP_ROLE_NOT_ALLOWED");

    const adminSelfPromotion = await app.inject({
      method: "PATCH", url: `${base}/${adminMembershipId}`,
      headers: { cookie: adminCookie }, payload: { role: "owner" },
    });
    assert.equal(adminSelfPromotion.statusCode, 409);
    assert.equal(adminSelfPromotion.json().error.code, "MEMBERSHIP_SELF_MODIFICATION");

    // Last owner invariant survives real SQL counting
    const ownerMembershipId = initial.json()[0].id;
    const demoteLastOwner = await app.inject({
      method: "PATCH", url: `${base}/${ownerMembershipId}`,
      headers: { cookie: ownerCookie }, payload: { role: "admin" },
    });
    assert.equal(demoteLastOwner.statusCode, 409);
    assert.equal(demoteLastOwner.json().error.code, "LAST_OWNER_REQUIRED");

    const secondOwnerEmail = `owner2-${unique}@example.com`;
    createdEmails.push(secondOwnerEmail);
    const secondOwner = await app.inject({
      method: "POST", url: base, headers: { cookie: ownerCookie },
      payload: { email: secondOwnerEmail, role: "owner", name: "Segundo Owner", password: "owner-password-1" },
    });
    assert.equal(secondOwner.statusCode, 201);
    const demoted = await app.inject({
      method: "PATCH", url: `${base}/${ownerMembershipId}`,
      headers: { cookie: ownerCookie }, payload: { role: "admin" },
    });
    assert.equal(demoted.statusCode, 200, JSON.stringify(demoted.json()));
    assert.equal(demoted.json().role, "admin");

    // The new owner removes a membership
    const secondOwnerCookie = await login(secondOwnerEmail, "owner-password-1");
    const removed = await app.inject({
      method: "DELETE", url: `${base}/${adminMembershipId}`,
      headers: { cookie: secondOwnerCookie },
    });
    assert.equal(removed.statusCode, 204);
    const afterRemoval = await app.inject({
      method: "GET", url: base, headers: { cookie: secondOwnerCookie },
    });
    assert.equal(afterRemoval.json().length, 3);

    const removeMissing = await app.inject({
      method: "DELETE", url: `${base}/00000000-0000-4000-8000-000000000000`,
      headers: { cookie: secondOwnerCookie },
    });
    assert.equal(removeMissing.statusCode, 404);
    assert.equal(removeMissing.json().error.code, "MEMBERSHIP_NOT_FOUND");

    // Administration stays available while the business is inactive
    await db.query("UPDATE businesses SET status = 'inactive' WHERE id = $1", [primary.businessId]);
    const inactiveList = await app.inject({
      method: "GET", url: base, headers: { cookie: secondOwnerCookie },
    });
    assert.equal(inactiveList.statusCode, 200);
    const inactiveReactivate = await app.inject({
      method: "PATCH", url: `/businesses/${primary.businessId}`,
      headers: { cookie: secondOwnerCookie }, payload: { status: "active" },
    });
    assert.equal(inactiveReactivate.statusCode, 200);
    assert.equal(inactiveReactivate.json().status, "active");
  },
);
