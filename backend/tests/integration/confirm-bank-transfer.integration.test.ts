import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";
import type { Pool } from "pg";

import { buildApp } from "../../src/app.js";
import type { Env } from "../../src/config/env.js";
import { createDatabasePool } from "../../src/core/database/database.js";
import { hashPassword } from "../../src/modules/auth/auth.crypto.js";
import { sessionCookieName } from "../../src/modules/auth/auth.cookie.js";
import type { BusinessRole } from "../../src/modules/memberships/memberships.types.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

interface Tenant {
  businessId: string;
  customerId: string;
  productId: string;
  methodId: string;
}

async function createTenant(db: Pool, suffix: string): Promise<Tenant> {
  const business = await db.query<{ id: string }>(
    "INSERT INTO businesses (name) VALUES ($1) RETURNING id",
    [`Transfer ${suffix}`],
  );
  const businessId = business.rows[0]?.id;
  assert.ok(businessId);
  const customer = await db.query<{ id: string }>(
    `INSERT INTO customers (business_id, name, email)
     VALUES ($1, $2, $3) RETURNING id`,
    [businessId, "Transfer Customer", `transfer-${suffix}@example.com`],
  );
  const customerId = customer.rows[0]?.id;
  assert.ok(customerId);
  const product = await db.query<{ id: string }>(
    `INSERT INTO products (business_id, name, type, status)
     VALUES ($1, $2, 'service', 'active') RETURNING id`,
    [businessId, "Transfer Product"],
  );
  const productId = product.rows[0]?.id;
  assert.ok(productId);
  const method = await db.query<{ id: string }>(
    `INSERT INTO business_payment_methods (business_id, type, name, config)
     VALUES ($1, 'bank_transfer', 'Transferencia', '{}'::jsonb) RETURNING id`,
    [businessId],
  );
  const methodId = method.rows[0]?.id;
  assert.ok(methodId);
  return { businessId, customerId, productId, methodId };
}

async function createMember(
  db: Pool,
  tenant: Tenant,
  role: BusinessRole,
  suffix: string,
  createdEmails: string[],
): Promise<{ email: string; password: string }> {
  const email = `${role}-${suffix}@example.com`;
  const password = "integration-password";
  const user = await db.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [email, `Transfer ${role}`, await hashPassword(password)],
  );
  const userId = user.rows[0]?.id;
  assert.ok(userId);
  createdEmails.push(email);
  await db.query(
    `INSERT INTO business_memberships (business_id, user_id, role) VALUES ($1, $2, $3)`,
    [tenant.businessId, userId, role],
  );
  return { email, password };
}

async function createOrder(db: Pool, tenant: Tenant, suffix: string, total: number): Promise<string> {
  const quote = await db.query<{ id: string }>(
    `INSERT INTO quotes (
       business_id, customer_id, product_id, quantity, product_name,
       currency, pricing_type, unit_price, total_price, status
     ) VALUES ($1, $2, $3, 1, 'Transfer Product', 'CLP', 'unit', $4, $4, 'converted')
     RETURNING id`,
    [tenant.businessId, tenant.customerId, tenant.productId, total],
  );
  const quoteId = quote.rows[0]?.id;
  assert.ok(quoteId);
  const order = await db.query<{ id: string }>(
    `INSERT INTO orders (business_id, customer_id, quote_id, status, currency, subtotal, total)
     VALUES ($1, $2, $3, 'pending_payment', 'CLP', $4, $4) RETURNING id`,
    [tenant.businessId, tenant.customerId, quoteId, total],
  );
  const orderId = order.rows[0]?.id;
  assert.ok(orderId);
  return orderId;
}

async function createPendingTransfer(
  db: Pool,
  tenant: Tenant,
  orderId: string,
  total: number,
  key: string,
): Promise<string> {
  const payment = await db.query<{ id: string }>(
    `INSERT INTO payments (
       business_id, order_id, payment_method_id, provider_key, amount, currency, idempotency_key
     ) VALUES ($1, $2, $3, 'bank_transfer', $4, 'CLP', $5) RETURNING id`,
    [tenant.businessId, orderId, tenant.methodId, total, key],
  );
  const paymentId = payment.rows[0]?.id;
  assert.ok(paymentId);
  return paymentId;
}

function expectError(
  response: { statusCode: number; json: () => { error?: { code?: string } } },
  statusCode: number,
  code: string,
): void {
  assert.equal(response.statusCode, statusCode, JSON.stringify(response.json()));
  assert.equal(response.json().error?.code, code);
}

test(
  "bank transfer confirmation HTTP flow against PostgreSQL",
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
    const tenant = await createTenant(db, unique);
    const otherTenant = await createTenant(db, `${unique}-other`);
    businessIds.push(tenant.businessId, otherTenant.businessId);
    const owner = await createMember(db, tenant, "owner", unique, createdEmails);
    const operator = await createMember(db, tenant, "operator", unique, createdEmails);
    const foreignOwner = await createMember(
      db, otherTenant, "owner", `${unique}-other`, createdEmails,
    );

    async function login(email: string, password: string): Promise<string> {
      const response = await app.inject({
        method: "POST", url: "/auth/login", payload: { email, password },
      });
      assert.equal(response.statusCode, 200);
      const header = response.headers["set-cookie"];
      const serialized = Array.isArray(header) ? header[0] : header;
      assert.ok(serialized);
      return serialized.split(";", 1)[0] ?? "";
    }

    const ownerCookie = await login(owner.email, owner.password);
    const operatorCookie = await login(operator.email, operator.password);
    const foreignCookie = await login(foreignOwner.email, foreignOwner.password);
    const confirmUrl = (paymentId: string) =>
      `/businesses/${tenant.businessId}/payments/${paymentId}/confirm-bank-transfer`;

    // Authorization and validation
    const anonymous = await app.inject({
      method: "POST", url: confirmUrl("00000000-0000-4000-8000-000000000000"),
      payload: { reference: "receipt-anon" },
    });
    expectError(anonymous, 401, "AUTHENTICATION_REQUIRED");

    const missingReference = await app.inject({
      method: "POST", url: confirmUrl("00000000-0000-4000-8000-000000000000"),
      headers: { cookie: ownerCookie }, payload: {},
    });
    expectError(missingReference, 400, "INVALID_REQUEST");

    const unknownPayment = await app.inject({
      method: "POST", url: confirmUrl("00000000-0000-4000-8000-000000000000"),
      headers: { cookie: ownerCookie }, payload: { reference: "receipt-unknown" },
    });
    expectError(unknownPayment, 404, "PAYMENT_NOT_FOUND");

    // Terminal and provider-mismatch states
    const terminalOrder = await createOrder(db, tenant, `${unique}-terminal`, 5_000);
    const terminalPayment = await createPendingTransfer(db, tenant, terminalOrder, 5_000, `terminal-${unique}`);
    await db.query(
      `UPDATE payments SET status = 'rejected' WHERE business_id = $1 AND id = $2`,
      [tenant.businessId, terminalPayment],
    );
    const terminal = await app.inject({
      method: "POST", url: confirmUrl(terminalPayment),
      headers: { cookie: ownerCookie }, payload: { reference: `receipt-terminal-${unique}` },
    });
    expectError(terminal, 409, "PAYMENT_INVALID_TRANSITION");

    const mercadoOrder = await createOrder(db, tenant, `${unique}-mp`, 7_000);
    const mercadoPayment = await db.query<{ id: string }>(
      `INSERT INTO payments (business_id, order_id, provider_key, amount, currency)
       VALUES ($1, $2, 'mercado_pago', 7_000, 'CLP') RETURNING id`,
      [tenant.businessId, mercadoOrder],
    );
    const mercadoPaymentId = mercadoPayment.rows[0]?.id;
    assert.ok(mercadoPaymentId);
    const mismatch = await app.inject({
      method: "POST", url: confirmUrl(mercadoPaymentId),
      headers: { cookie: ownerCookie }, payload: { reference: `receipt-mp-${unique}` },
    });
    expectError(mismatch, 409, "PAYMENT_METHOD_MISMATCH");

    // Operator cannot approve money
    const operatorOrder = await createOrder(db, tenant, `${unique}-operator`, 9_000);
    const operatorPayment = await createPendingTransfer(db, tenant, operatorOrder, 9_000, `operator-${unique}`);
    const operatorAttempt = await app.inject({
      method: "POST", url: confirmUrl(operatorPayment),
      headers: { cookie: operatorCookie }, payload: { reference: `receipt-operator-${unique}` },
    });
    expectError(operatorAttempt, 403, "INSUFFICIENT_BUSINESS_ROLE");
    const operatorState = await db.query<{ status: string }>(
      "SELECT status::text AS status FROM payments WHERE business_id = $1 AND id = $2",
      [tenant.businessId, operatorPayment],
    );
    assert.equal(operatorState.rows[0]?.status, "pending");

    // Cross-tenant isolation
    const foreignAttempt = await app.inject({
      method: "POST", url: confirmUrl(operatorPayment),
      headers: { cookie: foreignCookie }, payload: { reference: `receipt-foreign-${unique}` },
    });
    expectError(foreignAttempt, 404, "BUSINESS_NOT_FOUND");

    // Owner confirms a verified transfer
    const orderId = await createOrder(db, tenant, `${unique}-ok`, 15_000);
    const paymentId = await createPendingTransfer(db, tenant, orderId, 15_000, `ok-${unique}`);
    const reference = `receipt-${unique}`;
    const confirmed = await app.inject({
      method: "POST", url: confirmUrl(paymentId),
      headers: { cookie: ownerCookie }, payload: { reference },
    });
    assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.json()));
    assert.equal(confirmed.json().status, "approved");
    assert.equal(confirmed.json().providerPaymentId, reference);
    assert.ok(confirmed.json().approvedAt);

    const state = await db.query<{ payment_status: string; order_status: string; approved_at: string | null }>(
      `SELECT p.status::text AS payment_status, o.status::text AS order_status, p.approved_at
       FROM payments p JOIN orders o ON o.id = p.order_id AND o.business_id = p.business_id
       WHERE p.business_id = $1 AND p.id = $2`,
      [tenant.businessId, paymentId],
    );
    assert.equal(state.rows[0]?.payment_status, "approved");
    assert.equal(state.rows[0]?.order_status, "paid");
    assert.ok(state.rows[0]?.approved_at);

    // Safe repetition with the same reference
    const repeated = await app.inject({
      method: "POST", url: confirmUrl(paymentId),
      headers: { cookie: ownerCookie }, payload: { reference },
    });
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.json().id, paymentId);
    const approvedCount = await db.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM payments
       WHERE business_id = $1 AND order_id = $2 AND status = 'approved'`,
      [tenant.businessId, orderId],
    );
    assert.equal(approvedCount.rows[0]?.count, 1);

    // Same payment, different reference
    const wrongReference = await app.inject({
      method: "POST", url: confirmUrl(paymentId),
      headers: { cookie: ownerCookie }, payload: { reference: `${reference}-other` },
    });
    expectError(wrongReference, 409, "PAYMENT_TRANSFER_REFERENCE_MISMATCH");

    // Reference already used by another payment of the same business
    const conflictOrder = await createOrder(db, tenant, `${unique}-conflict`, 8_000);
    const conflictPayment = await createPendingTransfer(db, tenant, conflictOrder, 8_000, `conflict-${unique}`);
    const conflict = await app.inject({
      method: "POST", url: confirmUrl(conflictPayment),
      headers: { cookie: ownerCookie }, payload: { reference },
    });
    expectError(conflict, 409, "PAYMENT_TRANSFER_REFERENCE_CONFLICT");

    // Concurrent confirmations of the same payment stay idempotent and atomic
    const raceOrder = await createOrder(db, tenant, `${unique}-race`, 11_000);
    const racePayment = await createPendingTransfer(db, tenant, raceOrder, 11_000, `race-${unique}`);
    const raceReference = `receipt-race-${unique}`;
    const responses = await Promise.all([1, 2, 3].map(() => app.inject({
      method: "POST", url: confirmUrl(racePayment),
      headers: { cookie: ownerCookie }, payload: { reference: raceReference },
    })));
    for (const response of responses) {
      assert.equal(response.statusCode, 200, JSON.stringify(response.json()));
      assert.equal(response.json().id, racePayment);
      assert.equal(response.json().status, "approved");
    }
    const raceState = await db.query<{ payment_status: string; order_status: string }>(
      `SELECT p.status::text AS payment_status, o.status::text AS order_status
       FROM payments p JOIN orders o ON o.id = p.order_id AND o.business_id = p.business_id
       WHERE p.business_id = $1 AND p.id = $2`,
      [tenant.businessId, racePayment],
    );
    assert.equal(raceState.rows[0]?.payment_status, "approved");
    assert.equal(raceState.rows[0]?.order_status, "paid");
    const raceApproved = await db.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM payments
       WHERE business_id = $1 AND order_id = $2 AND status = 'approved'`,
      [tenant.businessId, raceOrder],
    );
    assert.equal(raceApproved.rows[0]?.count, 1);

    // An inactive business cannot approve money but keeps reading administration
    await db.query("UPDATE businesses SET status = 'inactive' WHERE id = $1", [tenant.businessId]);
    const inactiveOrder = await createOrder(db, tenant, `${unique}-inactive`, 4_000);
    const inactivePayment = await createPendingTransfer(db, tenant, inactiveOrder, 4_000, `inactive-${unique}`);
    const inactiveAttempt = await app.inject({
      method: "POST", url: confirmUrl(inactivePayment),
      headers: { cookie: ownerCookie }, payload: { reference: `receipt-inactive-${unique}` },
    });
    expectError(inactiveAttempt, 409, "BUSINESS_INACTIVE");
  },
);
