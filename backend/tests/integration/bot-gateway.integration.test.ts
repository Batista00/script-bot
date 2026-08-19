import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { buildApp } from "../../src/app.js";
import type { Env } from "../../src/config/env.js";
import { hashApiCredentialToken } from "../../src/modules/api-credentials/api-credentials.crypto.js";
import { PostgresApiCredentialsRepository } from "../../src/modules/api-credentials/api-credentials.repository.js";
import { ApiCredentialsService } from "../../src/modules/api-credentials/api-credentials.service.js";
import { PostgresBusinessesRepository } from "../../src/modules/businesses/businesses.repository.js";
import { PostgresCategoriesRepository } from "../../src/modules/categories/categories.repository.js";
import { PostgresPricingRepository } from "../../src/modules/pricing/pricing.repository.js";
import { PricingService } from "../../src/modules/pricing/pricing.service.js";
import { PostgresProductsRepository } from "../../src/modules/products/products.repository.js";
import { ProductsService } from "../../src/modules/products/products.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test(
  "Machine credentials and Bot Gateway isolation against PostgreSQL",
  { skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is not configured" },
  async (t) => {
    if (!testDatabaseUrl) return;
    await runner({
      databaseUrl: testDatabaseUrl, direction: "up", dir: "migrations",
      migrationsTable: "pgmigrations", count: Infinity, log: () => undefined,
    });
    const config: Env = {
      NODE_ENV: "test", PORT: 3000, DATABASE_URL: testDatabaseUrl,
      LOG_LEVEL: "silent", AUTH_SESSION_TTL_HOURS: 168,
    };
    const app = await buildApp(config);
    const businesses = new PostgresBusinessesRepository(app.db);
    const productsRepository = new PostgresProductsRepository(app.db);
    const pricingRepository = new PostgresPricingRepository(app.db);
    const products = new ProductsService(
      productsRepository, new PostgresCategoriesRepository(app.db),
    );
    const pricing = new PricingService(pricingRepository, productsRepository);
    const credentialsRepository = new PostgresApiCredentialsRepository(app.db);
    const credentials = new ApiCredentialsService(credentialsRepository);
    const businessIds: string[] = [];
    t.after(async () => {
      for (const businessId of businessIds) {
        await app.db.query("DELETE FROM businesses WHERE id = $1", [businessId]);
      }
      await app.close();
    });

    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const businessA = await businesses.create(`Gateway A ${unique}`);
    const businessB = await businesses.create(`Gateway B ${unique}`);
    businessIds.push(businessA.id, businessB.id);
    const productA = await products.create(businessA.id, {
      name: "Gateway Product A", type: "service", minQuantity: 1, maxQuantity: 1000,
    });
    const productB = await products.create(businessB.id, {
      name: "Gateway Product B", type: "service", minQuantity: 1, maxQuantity: 1000,
    });
    await pricing.create(businessA.id, productA.id, {
      pricingType: "unit", currency: "CLP", unitPrice: 3,
    });
    await pricing.create(businessB.id, productB.id, {
      pricingType: "unit", currency: "CLP", unitPrice: 7,
    });

    const active = await credentials.create(businessA.id, { name: "Typebot Principal" });
    const stored = await app.db.query<{ token_hash: string; token_prefix: string }>(
      `SELECT token_hash, token_prefix FROM business_api_credentials WHERE id = $1`,
      [active.credential.id],
    );
    assert.equal(stored.rows[0]?.token_hash, hashApiCredentialToken(active.token));
    assert.notEqual(stored.rows[0]?.token_hash, active.token);
    assert.equal(stored.rows[0]?.token_prefix, active.token.slice(0, 11));
    const auth = { authorization: `Bearer ${active.token}` };

    const resolved = await app.inject({
      method: "POST", url: "/bot/v1/customers/resolve", headers: auth,
      payload: { name: " Juan ", phone: "+56 9 1111-2222" },
    });
    assert.equal(resolved.statusCode, 200);
    assert.equal(resolved.json().phone, "+56911112222");
    const customerId = resolved.json().customerId as string;
    const repeated = await app.inject({
      method: "POST", url: "/bot/v1/customers/resolve", headers: auth,
      payload: { phone: "+56 (9) 1111 2222" },
    });
    assert.equal(repeated.json().customerId, customerId);

    const productResponse = await app.inject({
      method: "GET", url: `/bot/v1/products/${productA.id}`, headers: auth,
    });
    assert.equal(productResponse.statusCode, 200);
    assert.equal(productResponse.json().productId, productA.id);
    const foreignProduct = await app.inject({
      method: "GET", url: `/bot/v1/products/${productB.id}`, headers: auth,
    });
    assert.equal(foreignProduct.statusCode, 404);
    assert.equal(foreignProduct.json().error.code, "PRODUCT_NOT_FOUND");
    const foreignProductQuote = await app.inject({
      method: "POST", url: "/bot/v1/quotes", headers: auth,
      payload: { productId: productB.id, quantity: 10, currency: "CLP", customerId },
    });
    assert.equal(foreignProductQuote.statusCode, 404);
    assert.equal(foreignProductQuote.json().error.code, "PRODUCT_NOT_FOUND");

    const quoteResponse = await app.inject({
      method: "POST", url: "/bot/v1/quotes", headers: auth,
      payload: { productId: productA.id, quantity: 100, currency: "CLP", customerId },
    });
    assert.equal(quoteResponse.statusCode, 201);
    assert.equal(quoteResponse.json().totalPrice, 300);
    const orderResponse = await app.inject({
      method: "POST", url: "/bot/v1/orders", headers: auth,
      payload: { quoteId: quoteResponse.json().quoteId },
    });
    assert.equal(orderResponse.statusCode, 201);
    assert.equal(orderResponse.json().status, "pending_payment");
    const orderRead = await app.inject({
      method: "GET", url: `/bot/v1/orders/${orderResponse.json().orderId}`, headers: auth,
    });
    assert.equal(orderRead.statusCode, 200);

    const foreignCustomer = await app.db.query<{ id: string }>(
      `INSERT INTO customers (business_id, phone) VALUES ($1, $2) RETURNING id`,
      [businessB.id, `+56${Date.now().toString().slice(-9)}`],
    );
    const foreignQuote = await app.db.query<{ id: string }>(
      `INSERT INTO quotes
         (business_id, customer_id, product_id, quantity, product_name, currency,
          pricing_type, unit_price, total_price, status)
       VALUES ($1, $2, $3, 10, 'Foreign', 'CLP', 'unit', 7, 70, 'active') RETURNING id`,
      [businessB.id, foreignCustomer.rows[0]!.id, productB.id],
    );
    const foreignOrder = await app.inject({
      method: "POST", url: "/bot/v1/orders", headers: auth,
      payload: { quoteId: foreignQuote.rows[0]!.id },
    });
    assert.equal(foreignOrder.statusCode, 404);

    const inactive = await credentials.create(businessA.id, { name: "Inactive Bot" });
    await credentials.update(businessA.id, inactive.credential.id, { status: "inactive" });
    const denied = await app.inject({
      method: "GET", url: "/bot/v1/products",
      headers: { authorization: `Bearer ${inactive.token}` },
    });
    assert.equal(denied.statusCode, 401);
  },
);
