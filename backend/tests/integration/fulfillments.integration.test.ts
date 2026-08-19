import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { createDatabasePool } from "../../src/core/database/database.js";
import type {
  CreateProviderOrderInput,
  GetProviderOrderStatusInput,
  ProviderFulfillmentAdapter,
  ProviderOrderStatusResult,
} from "../../src/modules/fulfillments/fulfillments.adapter.js";
import { ProviderFulfillmentRegistry } from "../../src/modules/fulfillments/fulfillments.registry.js";
import { PostgresFulfillmentsRepository } from "../../src/modules/fulfillments/fulfillments.repository.js";
import { FulfillmentsService } from "../../src/modules/fulfillments/fulfillments.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

class FakeAdapter implements ProviderFulfillmentAdapter {
  readonly key = "smm_raja";
  createCount = 0;
  status: ProviderOrderStatusResult = {
    providerOrderId: "1001", providerStatusRaw: "Completed", status: "completed",
    charge: "12.340000000001", currency: "USD", remains: 0, startCount: 100,
  };
  async createOrder(_input: CreateProviderOrderInput) {
    this.createCount += 1;
    return { providerOrderId: String(1000 + this.createCount) };
  }
  async getOrderStatus(_input: GetProviderOrderStatusInput) {
    return structuredClone(this.status);
  }
}

interface Fixture {
  businessId: string;
  productId: string;
  integrationId: string;
  providerServiceId: string;
}

test(
  "Fulfillment invariants and transitions against PostgreSQL",
  { skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is not configured" },
  async (t) => {
    if (!testDatabaseUrl) return;
    await runner({
      databaseUrl: testDatabaseUrl, direction: "up", dir: "migrations",
      migrationsTable: "pgmigrations", count: Infinity, log: () => undefined,
    });
    const db = createDatabasePool(testDatabaseUrl);
    const businessIds: string[] = [];
    t.after(async () => {
      for (const businessId of businessIds) {
        await db.query("DELETE FROM businesses WHERE id = $1", [businessId]);
      }
      await db.end();
    });
    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    async function fixture(label: string): Promise<Fixture> {
      const business = await db.query<{ id: string }>(
        "INSERT INTO businesses (name) VALUES ($1) RETURNING id", [`Fulfillment ${label} ${unique}`],
      );
      const businessId = business.rows[0]!.id;
      businessIds.push(businessId);
      const product = await db.query<{ id: string }>(
        `INSERT INTO products (business_id, name, type, status)
         VALUES ($1, $2, 'service', 'active') RETURNING id`, [businessId, `Product ${label}`],
      );
      const integration = await db.query<{ id: string }>(
        `INSERT INTO business_integrations
           (business_id, provider_key, status, config, credentials_encrypted)
         VALUES ($1, 'smm_raja', 'active', '{}', 'test-placeholder') RETURNING id`, [businessId],
      );
      const providerService = await db.query<{ id: string }>(
        `INSERT INTO provider_services
           (business_id, integration_id, provider_key, external_service_id, name,
            service_type, rate, min_quantity, max_quantity, last_synced_at)
         VALUES ($1, $2, 'smm_raja', '321', 'Provider service', 'Default', 1.25, 10, 1000, now())
         RETURNING id`, [businessId, integration.rows[0]!.id],
      );
      await db.query(
        `INSERT INTO product_provider_mappings
           (business_id, product_id, provider_service_id, status)
         VALUES ($1, $2, $3, 'active')`,
        [businessId, product.rows[0]!.id, providerService.rows[0]!.id],
      );
      return {
        businessId, productId: product.rows[0]!.id,
        integrationId: integration.rows[0]!.id,
        providerServiceId: providerService.rows[0]!.id,
      };
    }

    async function paidOrder(value: Fixture, suffix: string) {
      const customer = await db.query<{ id: string }>(
        `INSERT INTO customers (business_id, name, phone)
         VALUES ($1, $2, $3) RETURNING id`,
        [value.businessId, `Customer ${suffix}`, `+56${Date.now()}${Math.floor(Math.random() * 1000)}`],
      );
      const quote = await db.query<{ id: string }>(
        `INSERT INTO quotes
           (business_id, customer_id, product_id, quantity, product_name, currency,
            pricing_type, unit_price, total_price, status)
         VALUES ($1, $2, $3, 100, 'Snapshot product', 'CLP', 'unit', 2, 200, 'converted')
         RETURNING id`, [value.businessId, customer.rows[0]!.id, value.productId],
      );
      const order = await db.query<{ id: string }>(
        `INSERT INTO orders
           (business_id, customer_id, quote_id, status, currency, subtotal, total)
         VALUES ($1, $2, $3, 'paid', 'CLP', 200, 200) RETURNING id`,
        [value.businessId, customer.rows[0]!.id, quote.rows[0]!.id],
      );
      const item = await db.query<{ id: string }>(
        `INSERT INTO order_items
           (business_id, order_id, product_id, product_name, quantity,
            pricing_type, unit_price, total_price)
         VALUES ($1, $2, $3, 'Snapshot product', 100, 'unit', 2, 200) RETURNING id`,
        [value.businessId, order.rows[0]!.id, value.productId],
      );
      return { orderId: order.rows[0]!.id, orderItemId: item.rows[0]!.id };
    }

    const a = await fixture("A");
    const b = await fixture("B");
    const adapter = new FakeAdapter();
    const service = new FulfillmentsService(
      new PostgresFulfillmentsRepository(db), db,
      new ProviderFulfillmentRegistry([adapter]),
    );

    const completedOrder = await paidOrder(a, "completed");
    const fulfillment = await service.dispatch(a.businessId, completedOrder.orderId, {
      orderItemId: completedOrder.orderItemId,
      input: { link: "https://instagram.com/example" },
    });
    assert.equal(fulfillment.status, "submitted");
    assert.equal(fulfillment.integrationId, a.integrationId);
    assert.equal(fulfillment.providerServiceId, a.providerServiceId);
    assert.equal((await db.query<{ status: string }>(
      "SELECT status::text FROM orders WHERE id = $1", [completedOrder.orderId],
    )).rows[0]?.status, "processing");

    await assert.rejects(
      db.query(
        `INSERT INTO fulfillments
           (business_id, order_id, order_item_id, product_id, integration_id,
            provider_service_id, provider_key, external_service_id, provider_service_type,
            quantity, input_data)
         SELECT business_id, order_id, order_item_id, product_id, integration_id,
                provider_service_id, provider_key, external_service_id, provider_service_type,
                quantity, input_data FROM fulfillments WHERE id = $1`, [fulfillment.id],
      ),
      (error: unknown) => (error as { code?: string }).code === "23505",
    );

    const secondOrder = await paidOrder(a, "unique-provider");
    const second = await service.dispatch(a.businessId, secondOrder.orderId, {
      orderItemId: secondOrder.orderItemId, input: { link: "https://instagram.com/second" },
    });
    await assert.rejects(
      db.query("UPDATE fulfillments SET provider_order_id = $1 WHERE id = $2",
        [fulfillment.providerOrderId, second.id]),
      (error: unknown) => (error as { code?: string }).code === "23505",
    );

    const foreignOrder = await paidOrder(b, "foreign");
    await assert.rejects(
      db.query(
        `INSERT INTO fulfillments
           (business_id, order_id, order_item_id, product_id, integration_id,
            provider_service_id, provider_key, external_service_id, provider_service_type,
            quantity, input_data)
         VALUES ($1, $2, $3, $4, $5, $6, 'smm_raja', '321', 'Default', 100, '{}')`,
        [b.businessId, foreignOrder.orderId, foreignOrder.orderItemId, b.productId,
          a.integrationId, a.providerServiceId],
      ),
      (error: unknown) => (error as { code?: string }).code === "23503",
    );

    await db.query(
      "UPDATE product_provider_mappings SET status = 'inactive' WHERE business_id = $1",
      [a.businessId],
    );
    const replacement = await db.query<{ id: string }>(
      `INSERT INTO provider_services
         (business_id, integration_id, provider_key, external_service_id, name,
          service_type, rate, min_quantity, max_quantity, last_synced_at)
       VALUES ($1, $2, 'smm_raja', '999', 'Replacement', 'Default', 2, 10, 1000, now())
       RETURNING id`, [a.businessId, a.integrationId],
    );
    await db.query(
      `INSERT INTO product_provider_mappings
         (business_id, product_id, provider_service_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [a.businessId, a.productId, replacement.rows[0]!.id],
    );
    const snapshot = await service.getById(a.businessId, fulfillment.id);
    assert.equal(snapshot.providerServiceId, a.providerServiceId);
    assert.equal(snapshot.externalServiceId, "321");

    adapter.status = {
      providerOrderId: fulfillment.providerOrderId!, providerStatusRaw: "Completed",
      status: "completed", charge: "12.340000000001", currency: "USD",
      remains: 0, startCount: 100,
    };
    const completed = await service.syncStatus(a.businessId, fulfillment.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.providerCharge, "12.340000000001");
    const numeric = await db.query<{ charge: string; data_type: string }>(
      `SELECT provider_charge::text AS charge, pg_typeof(provider_charge)::text AS data_type
       FROM fulfillments WHERE id = $1`, [fulfillment.id],
    );
    assert.deepEqual(numeric.rows[0], { charge: "12.340000000001", data_type: "numeric" });
    assert.equal((await db.query<{ status: string }>(
      "SELECT status::text FROM orders WHERE id = $1", [completedOrder.orderId],
    )).rows[0]?.status, "completed");

    for (const terminal of ["partial", "cancelled"] as const) {
      const target = await paidOrder(a, terminal);
      const dispatched = await service.dispatch(a.businessId, target.orderId, {
        orderItemId: target.orderItemId, input: { link: `https://instagram.com/${terminal}` },
      });
      adapter.status = {
        providerOrderId: dispatched.providerOrderId!, providerStatusRaw: terminal,
        status: terminal, charge: null, currency: null, remains: null, startCount: null,
      };
      assert.equal((await service.syncStatus(a.businessId, dispatched.id)).status, terminal);
      assert.equal((await db.query<{ status: string }>(
        "SELECT status::text FROM orders WHERE id = $1", [target.orderId],
      )).rows[0]?.status, "failed");
    }
  },
);
