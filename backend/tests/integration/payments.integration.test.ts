import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";
import type { Pool } from "pg";

import { createDatabasePool } from "../../src/core/database/database.js";
import { AppError } from "../../src/core/errors/app-error.js";
import { PaymentProviderRegistry } from "../../src/modules/payments/payments.registry.js";
import { PostgresPaymentsRepository } from "../../src/modules/payments/payments.repository.js";
import { PaymentsService } from "../../src/modules/payments/payments.service.js";
import { FakePaymentProvider } from "../support/payments-memory.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

interface Fixture { businessId: string; orderId: string }

async function createOrderFixture(db: Pool, suffix: string, total = 15_000): Promise<Fixture> {
  const business = await db.query<{ id: string }>(
    "INSERT INTO businesses (name) VALUES ($1) RETURNING id",
    [`Payments ${suffix}`],
  );
  const businessId = business.rows[0]?.id;
  assert.ok(businessId);
  const customer = await db.query<{ id: string }>(
    `INSERT INTO customers (business_id, name, email)
     VALUES ($1, $2, $3) RETURNING id`,
    [businessId, "Payments Customer", `payments-${suffix}@example.com`],
  );
  const customerId = customer.rows[0]?.id;
  assert.ok(customerId);
  const product = await db.query<{ id: string }>(
    `INSERT INTO products (business_id, name, type, status)
     VALUES ($1, $2, 'service', 'active') RETURNING id`,
    [businessId, "Payments Product"],
  );
  const productId = product.rows[0]?.id;
  assert.ok(productId);
  const quote = await db.query<{ id: string }>(
    `INSERT INTO quotes (
       business_id, customer_id, product_id, quantity, product_name,
       currency, pricing_type, unit_price, total_price, status
     ) VALUES ($1, $2, $3, 1, $4, 'CLP', 'unit', $5, $5, 'converted')
     RETURNING id`,
    [businessId, customerId, productId, "Payments Product", total],
  );
  const quoteId = quote.rows[0]?.id;
  assert.ok(quoteId);
  const order = await db.query<{ id: string }>(
    `INSERT INTO orders (
       business_id, customer_id, quote_id, status, currency, subtotal, total
     ) VALUES ($1, $2, $3, 'pending_payment', 'CLP', $4, $4)
     RETURNING id`,
    [businessId, customerId, quoteId, total],
  );
  const orderId = order.rows[0]?.id;
  assert.ok(orderId);
  return { businessId, orderId };
}

test(
  "Payments Core invariants against PostgreSQL",
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
    const provider = new FakePaymentProvider("postgres_provider");
    const repository = new PostgresPaymentsRepository(db);
    const service = new PaymentsService(
      repository,
      db,
      new PaymentProviderRegistry([provider]),
      () => new Date("2026-08-18T12:00:00.000Z"),
    );
    const businessIds: string[] = [];
    t.after(async () => {
      for (const businessId of businessIds) {
        await db.query("DELETE FROM businesses WHERE id = $1", [businessId]);
      }
      await db.end();
    });

    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const base = await createOrderFixture(db, `${unique}-base`, 42_000);
    businessIds.push(base.businessId);
    provider.result = {
      providerReferenceId: `preference-${unique}`,
      status: "pending",
      checkoutUrl: "https://payments.example/postgres",
    };
    const created = await service.create(
      base.businessId,
      base.orderId,
      provider.key,
      `idem-${unique}`,
    );
    const repeated = await service.create(
      base.businessId,
      base.orderId,
      provider.key,
      `idem-${unique}`,
    );
    assert.equal(created.payment.amount, 42_000);
    assert.equal(created.payment.currency, "CLP");
    assert.equal(repeated.created, false);
    assert.equal(repeated.payment.id, created.payment.id);
    assert.equal(provider.calls.length, 1);
    assert.equal(created.payment.providerReferenceId, `preference-${unique}`);
    assert.equal(created.payment.providerPaymentId, null);

    const approved = await service.applyVerifiedProviderUpdate({
      businessId: base.businessId,
      paymentId: created.payment.id,
      providerKey: provider.key,
      providerPaymentId: `payment-${unique}`,
      status: "approved",
      amount: 42_000,
      currency: "CLP",
    });
    assert.equal(approved.providerReferenceId, `preference-${unique}`);
    assert.equal(approved.providerPaymentId, `payment-${unique}`);
    const atomicState = await db.query<{ payment_status: string; order_status: string }>(
      `SELECT p.status::text AS payment_status, o.status::text AS order_status
       FROM payments p JOIN orders o
         ON o.business_id = p.business_id AND o.id = p.order_id
       WHERE p.business_id = $1 AND p.id = $2`,
      [base.businessId, approved.id],
    );
    assert.deepEqual(atomicState.rows[0], {
      payment_status: "approved",
      order_status: "paid",
    });

    await assert.rejects(
      db.query(
        `INSERT INTO payments (
           business_id, order_id, provider_key, provider_reference_id,
           status, amount, currency
         ) VALUES ($1, $2, $3, $4, 'pending', $5, 'CLP')`,
        [base.businessId, base.orderId, provider.key, `preference-${unique}`, 42_000],
      ),
      (error: unknown) => (error as { code?: string }).code === "23505",
    );

    const isolatedReference = await createOrderFixture(db, `${unique}-reference-isolation`);
    businessIds.push(isolatedReference.businessId);
    provider.result = {
      providerReferenceId: `preference-${unique}`,
      status: "pending",
    };
    const isolatedPayment = await service.create(
      isolatedReference.businessId,
      isolatedReference.orderId,
      provider.key,
    );
    assert.equal(isolatedPayment.payment.providerReferenceId, `preference-${unique}`);

    const attempts = await createOrderFixture(db, `${unique}-attempts`);
    businessIds.push(attempts.businessId);
    provider.result = { providerPaymentId: `attempt-a-${unique}`, status: "pending" };
    await service.create(attempts.businessId, attempts.orderId, provider.key);
    provider.result = { providerPaymentId: `attempt-b-${unique}`, status: "pending" };
    const second = await service.create(attempts.businessId, attempts.orderId, provider.key);
    await service.applyProviderUpdate(
      attempts.businessId, provider.key, `attempt-a-${unique}`, "approved",
    );
    await assert.rejects(
      service.applyProviderUpdate(
        attempts.businessId, provider.key, `attempt-b-${unique}`, "approved",
      ),
      (error: unknown) => error instanceof AppError && error.code === "PAYMENT_ALREADY_APPROVED",
    );
    await assert.rejects(
      db.query(
        `UPDATE payments SET status = 'approved', approved_at = now()
         WHERE business_id = $1 AND id = $2`,
        [attempts.businessId, second.payment.id],
      ),
      (error: unknown) => (error as { code?: string }).code === "23505",
    );

    const rollback = await createOrderFixture(db, `${unique}-rollback`);
    businessIds.push(rollback.businessId);
    provider.result = { providerPaymentId: `rollback-${unique}`, status: "pending" };
    const rollbackPayment = await service.create(
      rollback.businessId, rollback.orderId, provider.key,
    );
    const failingRepository = new PostgresPaymentsRepository(db);
    failingRepository.markOrderPaid = async () => { throw new Error("forced PostgreSQL rollback"); };
    const failingService = new PaymentsService(
      failingRepository,
      db,
      new PaymentProviderRegistry([provider]),
    );
    await assert.rejects(
      failingService.applyProviderUpdate(
        rollback.businessId, provider.key, `rollback-${unique}`, "approved",
      ),
      /forced PostgreSQL rollback/,
    );
    const rollbackState = await db.query<{ payment_status: string; order_status: string }>(
      `SELECT p.status::text AS payment_status, o.status::text AS order_status
       FROM payments p JOIN orders o ON o.id = p.order_id AND o.business_id = p.business_id
       WHERE p.business_id = $1 AND p.id = $2`,
      [rollback.businessId, rollbackPayment.payment.id],
    );
    assert.deepEqual(rollbackState.rows[0], {
      payment_status: "pending",
      order_status: "pending_payment",
    });

    assert.equal(await repository.findById(rollback.businessId, created.payment.id), null);
    assert.deepEqual(await repository.list(base.businessId, {
      limit: 50, offset: 0, orderId: rollback.orderId,
    }), []);
  },
);
