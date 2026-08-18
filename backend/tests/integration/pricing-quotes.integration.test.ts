import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { buildApp } from "../../src/app.js";
import type { Env } from "../../src/config/env.js";
import { PostgresBusinessesRepository } from "../../src/modules/businesses/businesses.repository.js";
import { PostgresCustomersRepository } from "../../src/modules/customers/customers.repository.js";
import { PriceCalculatorService } from "../../src/modules/pricing/price-calculator.service.js";
import { PostgresPricingRepository } from "../../src/modules/pricing/pricing.repository.js";
import { PricingService } from "../../src/modules/pricing/pricing.service.js";
import { PriceRangeConflictError } from "../../src/modules/pricing/pricing.types.js";
import { PostgresProductsRepository } from "../../src/modules/products/products.repository.js";
import { PostgresQuotesRepository } from "../../src/modules/quotes/quotes.repository.js";
import { QuotesService } from "../../src/modules/quotes/quotes.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test(
  "pricing and quotes flow against PostgreSQL",
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
    const prices = new PostgresPricingRepository(app.db);
    const pricing = new PricingService(prices, products);
    const quotesRepository = new PostgresQuotesRepository(app.db);
    const quotes = new QuotesService(
      quotesRepository,
      new PriceCalculatorService(products, prices),
      customers,
    );
    const createdBusinessIds: string[] = [];

    t.after(async () => {
      for (const businessId of createdBusinessIds) {
        await app.db.query("DELETE FROM businesses WHERE id = $1", [businessId]);
      }
      await app.close();
    });

    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const businessA = await businesses.create(`Pricing A ${unique}`);
    const businessB = await businesses.create(`Pricing B ${unique}`);
    createdBusinessIds.push(businessA.id, businessB.id);
    const product = await products.create(businessA.id, {
      categoryId: null,
      name: "Seguidores Premium",
      description: null,
      type: "service",
      sku: null,
      minQuantity: 100,
      maxQuantity: 10_000,
      status: "active",
    });
    const foreignProduct = await products.create(businessB.id, {
      categoryId: null,
      name: "Foreign",
      description: null,
      type: "service",
      sku: null,
      minQuantity: null,
      maxQuantity: null,
      status: "active",
    });
    const customer = await customers.create(businessA.id, {
      name: "Integration Customer",
      phone: `+569${Date.now().toString().slice(-8)}`,
      email: null,
      status: "active",
    });

    const fixed = await pricing.create(businessA.id, product.id, {
      pricingType: "fixed", currency: "CLP", fixedPrice: 15_990,
    });
    const unit = await pricing.create(businessA.id, product.id, {
      pricingType: "unit", currency: "USD", unitPrice: 3,
    });
    assert.equal(fixed.fixedPrice, 15_990);
    assert.equal(unit.unitPrice, 3);
    await assert.rejects(
      prices.create(businessA.id, product.id, {
        pricingType: "fixed",
        currency: "CLP",
        fixedPrice: 20_000,
        unitPrice: null,
        minQuantity: 100,
        maxQuantity: 1000,
        status: "active",
      }),
      (error: unknown) => error instanceof PriceRangeConflictError,
    );

    await pricing.create(businessA.id, product.id, {
      pricingType: "fixed",
      currency: "EUR",
      fixedPrice: Number.MAX_SAFE_INTEGER,
    });

    const fixedQuote = await quotes.create(businessA.id, {
      productId: product.id,
      customerId: customer.id,
      quantity: 5000,
      currency: "clp",
    });
    const unitQuote = await quotes.create(businessA.id, {
      productId: product.id,
      quantity: 5000,
      currency: "USD",
    });
    const maximumSafeQuote = await quotes.create(businessA.id, {
      productId: product.id,
      quantity: 100,
      currency: "EUR",
    });
    assert.equal(fixedQuote.totalPrice, 15_990);
    assert.equal(unitQuote.totalPrice, 15_000);
    assert.equal(unitQuote.unitPrice, 3);
    assert.equal(maximumSafeQuote.totalPrice, Number.MAX_SAFE_INTEGER);

    await products.update(businessA.id, product.id, {
      categoryId: null,
      name: "Nombre actualizado",
      description: null,
      type: "service",
      sku: null,
      minQuantity: 100,
      maxQuantity: 10_000,
      status: "active",
    });
    const snapshot = await quotes.getById(businessA.id, fixedQuote.id);
    assert.equal(snapshot.productName, "Seguidores Premium");
    await assert.rejects(quotes.getById(businessB.id, fixedQuote.id));
    await assert.rejects(pricing.getById(businessB.id, foreignProduct.id, fixed.id));
  },
);
