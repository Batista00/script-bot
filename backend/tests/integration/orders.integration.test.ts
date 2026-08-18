import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { buildApp } from "../../src/app.js";
import type { Env } from "../../src/config/env.js";
import { AppError } from "../../src/core/errors/app-error.js";
import { PostgresBusinessesRepository } from "../../src/modules/businesses/businesses.repository.js";
import { PostgresCustomersRepository } from "../../src/modules/customers/customers.repository.js";
import { PostgresOrdersRepository } from "../../src/modules/orders/orders.repository.js";
import { OrdersService } from "../../src/modules/orders/orders.service.js";
import { PriceCalculatorService } from "../../src/modules/pricing/price-calculator.service.js";
import { PostgresPricingRepository } from "../../src/modules/pricing/pricing.repository.js";
import { PricingService } from "../../src/modules/pricing/pricing.service.js";
import { PostgresProductsRepository } from "../../src/modules/products/products.repository.js";
import { PostgresQuotesRepository } from "../../src/modules/quotes/quotes.repository.js";
import { QuotesService } from "../../src/modules/quotes/quotes.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test(
  "quote to order conversion against PostgreSQL",
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
    const config: Env = {
      NODE_ENV: "test", PORT: 3_000, DATABASE_URL: testDatabaseUrl,
      LOG_LEVEL: "silent", AUTH_SESSION_TTL_HOURS: 168,
    };
    const app = await buildApp(config);
    const businesses = new PostgresBusinessesRepository(app.db);
    const products = new PostgresProductsRepository(app.db);
    const customers = new PostgresCustomersRepository(app.db);
    const pricesRepository = new PostgresPricingRepository(app.db);
    const pricing = new PricingService(pricesRepository, products);
    const quotesRepository = new PostgresQuotesRepository(app.db);
    const quotes = new QuotesService(
      quotesRepository,
      new PriceCalculatorService(products, pricesRepository),
      customers,
    );
    const ordersRepository = new PostgresOrdersRepository(app.db);
    const orders = new OrdersService(ordersRepository, app.db);
    const businessIds: string[] = [];

    t.after(async () => {
      for (const businessId of businessIds) {
        await app.db.query("DELETE FROM businesses WHERE id = $1", [businessId]);
      }
      await app.close();
    });

    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const businessA = await businesses.create(`Orders A ${unique}`);
    const businessB = await businesses.create(`Orders B ${unique}`);
    businessIds.push(businessA.id, businessB.id);
    const product = await products.create(businessA.id, {
      categoryId: null, name: "Snapshot Product", description: null, type: "service",
      sku: null, minQuantity: 1, maxQuantity: 10_000, status: "active",
    });
    const customer = await customers.create(businessA.id, {
      name: "Orders Customer", phone: `+568${Date.now().toString().slice(-8)}`,
      email: null, status: "active",
    });
    await pricing.create(businessA.id, product.id, {
      pricingType: "unit", currency: "CLP", unitPrice: 3,
    });
    const quote = await quotes.create(businessA.id, {
      productId: product.id, customerId: customer.id, quantity: 5000, currency: "CLP",
    });
    const concurrentQuote = await quotes.create(businessA.id, {
      productId: product.id, customerId: customer.id, quantity: 1000, currency: "CLP",
    });
    const rollbackQuote = await quotes.create(businessA.id, {
      productId: product.id, customerId: customer.id, quantity: 100, currency: "CLP",
    });

    await products.update(businessA.id, product.id, {
      categoryId: null, name: "Changed Product", description: null, type: "service",
      sku: null, minQuantity: 1, maxQuantity: 10_000, status: "inactive",
    });
    const order = await orders.create(businessA.id, { quoteId: quote.id });
    assert.equal(order.status, "pending_payment");
    assert.equal(order.subtotal, 15_000);
    assert.equal(order.total, 15_000);
    assert.equal(order.items[0]?.productName, "Snapshot Product");
    assert.equal(order.items[0]?.totalPrice, 15_000);
    const quoteStatus = await app.db.query<{ status: string }>(
      "SELECT status FROM quotes WHERE business_id = $1 AND id = $2",
      [businessA.id, quote.id],
    );
    assert.equal(quoteStatus.rows[0]?.status, "converted");
    await assert.rejects(
      orders.getById(businessB.id, order.id),
      (error: unknown) => error instanceof AppError && error.code === "ORDER_NOT_FOUND",
    );

    const concurrent = await Promise.allSettled([
      orders.create(businessA.id, { quoteId: concurrentQuote.id }),
      orders.create(businessA.id, { quoteId: concurrentQuote.id }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
    const duplicateCount = await app.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM orders WHERE business_id = $1 AND quote_id = $2",
      [businessA.id, concurrentQuote.id],
    );
    assert.equal(duplicateCount.rows[0]?.count, "1");

    const failingRepository = new PostgresOrdersRepository(app.db);
    failingRepository.createItem = async () => { throw new Error("forced item failure"); };
    const failingOrders = new OrdersService(failingRepository, app.db);
    await assert.rejects(
      failingOrders.create(businessA.id, { quoteId: rollbackQuote.id }),
      /forced item failure/,
    );
    const rollbackState = await app.db.query<{ count: string; status: string }>(
      `SELECT
         (SELECT count(*)::text FROM orders WHERE quote_id = $2) AS count,
         (SELECT status::text FROM quotes WHERE business_id = $1 AND id = $2) AS status`,
      [businessA.id, rollbackQuote.id],
    );
    assert.equal(rollbackState.rows[0]?.count, "0");
    assert.equal(rollbackState.rows[0]?.status, "active");
  },
);
