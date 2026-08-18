import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";
import { AppError } from "../src/core/errors/app-error.js";
import { sessionCookieName } from "../src/modules/auth/auth.cookie.js";
import { PricingService } from "../src/modules/pricing/pricing.service.js";
import type {
  PricingRepository,
  ProductPrice,
  ProductPriceListOptions,
  ProductPricePersistenceInput,
} from "../src/modules/pricing/pricing.types.js";
import type {
  Product,
  ProductListOptions,
  ProductPersistenceInput,
  ProductsRepository,
} from "../src/modules/products/products.types.js";

const businessA = "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68";
const businessB = "9d1b85eb-ecbf-479c-838f-80e53e98c9a8";
const userId = "46f5476a-c7e9-403f-9fff-fc3bb234c8b6";
const membershipId = "273676c0-da1f-47d4-a0a7-15624760233b";
const missingId = "60878fd4-9a90-4f74-8905-d736c8b6ea11";
const now = "2026-08-18T12:00:00.000Z";

const testConfig: Env = {
  NODE_ENV: "test",
  PORT: 3_000,
  DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
  LOG_LEVEL: "silent",
  AUTH_SESSION_TTL_HOURS: 168,
};

class MemoryProductsRepository implements ProductsRepository {
  readonly products: Product[] = [];

  add(businessId: string): Product {
    const product: Product = {
      id: randomUUID(), businessId, categoryId: null, name: "Servicio", description: null,
      type: "service", sku: null, minQuantity: null, maxQuantity: null, status: "active",
      createdAt: now, updatedAt: now,
    };
    this.products.push(product);
    return product;
  }

  async findById(businessId: string, productId: string): Promise<Product | null> {
    return this.products.find((item) => item.businessId === businessId && item.id === productId) ?? null;
  }
  async create(_businessId: string, _input: ProductPersistenceInput): Promise<Product> {
    throw new Error("Not used");
  }
  async list(_businessId: string, _options: ProductListOptions): Promise<Product[]> { return []; }
  async findBySku(): Promise<Product | null> { return null; }
  async update(): Promise<Product | null> { return null; }
}

class MemoryPricingRepository implements PricingRepository {
  readonly prices: ProductPrice[] = [];

  async create(
    businessId: string,
    productId: string,
    input: ProductPricePersistenceInput,
  ): Promise<ProductPrice> {
    const price: ProductPrice = {
      id: randomUUID(), businessId, productId, ...input, createdAt: now, updatedAt: now,
    };
    this.prices.push(price);
    return price;
  }

  async list(
    businessId: string,
    productId: string,
    options: ProductPriceListOptions,
  ): Promise<ProductPrice[]> {
    return this.prices
      .filter((price) => price.businessId === businessId && price.productId === productId)
      .slice(options.offset, options.offset + options.limit);
  }

  async findById(
    businessId: string,
    productId: string,
    priceId: string,
  ): Promise<ProductPrice | null> {
    return this.prices.find((price) =>
      price.businessId === businessId && price.productId === productId && price.id === priceId) ?? null;
  }

  async findActiveRangeConflict(
    businessId: string,
    productId: string,
    currency: string,
    minQuantity: number | null,
    maxQuantity: number | null,
    excludePriceId?: string,
  ): Promise<ProductPrice | null> {
    return this.prices.find((price) =>
      price.businessId === businessId && price.productId === productId &&
      price.currency === currency && price.status === "active" && price.id !== excludePriceId &&
      (price.minQuantity === null || maxQuantity === null || price.minQuantity <= maxQuantity) &&
      (price.maxQuantity === null || minQuantity === null || price.maxQuantity >= minQuantity)) ?? null;
  }

  async findApplicableActive(
    businessId: string,
    productId: string,
    currency: string,
    quantity: number,
  ): Promise<ProductPrice | null> {
    return this.prices.find((price) =>
      price.businessId === businessId && price.productId === productId &&
      price.currency === currency && price.status === "active" &&
      (price.minQuantity === null || price.minQuantity <= quantity) &&
      (price.maxQuantity === null || price.maxQuantity >= quantity)) ?? null;
  }

  async update(
    businessId: string,
    productId: string,
    priceId: string,
    input: ProductPricePersistenceInput,
  ): Promise<ProductPrice | null> {
    const index = this.prices.findIndex((price) =>
      price.businessId === businessId && price.productId === productId && price.id === priceId);
    const existing = this.prices[index];
    if (!existing) return null;
    const updated = { ...existing, ...input, updatedAt: now };
    this.prices[index] = updated;
    return updated;
  }
}

function createService() {
  const products = new MemoryProductsRepository();
  const prices = new MemoryPricingRepository();
  return { products, prices, service: new PricingService(prices, products) };
}

function hasAppError(code: string, statusCode: number): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

async function buildOperatorApp() {
  const app = await buildApp(testConfig);
  app.authService.authenticate = async () => ({
    id: userId, email: "operator@example.com", name: "Operator", status: "active",
    createdAt: now, updatedAt: now,
  });
  app.membershipsRepository.findByBusinessAndUser = async () => ({
    id: membershipId, businessId: businessA, userId, role: "operator",
    createdAt: now, updatedAt: now,
  });
  app.db.query = (async () => ({ rows: [] })) as unknown as typeof app.db.query;
  return app;
}

const authHeaders = { cookie: `${sessionCookieName}=test-session` };

test("creates valid fixed pricing and normalizes currency", async () => {
  const { products, service } = createService();
  const product = products.add(businessA);
  const price = await service.create(businessA, product.id, {
    pricingType: "fixed", currency: " clp ", fixedPrice: 15_990,
  });
  assert.equal(price.currency, "CLP");
  assert.equal(price.fixedPrice, 15_990);
  assert.equal(price.unitPrice, null);
});

test("creates valid unit pricing", async () => {
  const { products, service } = createService();
  const product = products.add(businessA);
  const price = await service.create(businessA, product.id, {
    pricingType: "unit", currency: "USD", unitPrice: 3, minQuantity: 100, maxQuantity: 999,
  });
  assert.equal(price.pricingType, "unit");
  assert.equal(price.unitPrice, 3);
});

test("rejects zero, negative, and unsafe monetary amounts", async () => {
  const { products, service } = createService();
  const product = products.add(businessA);
  for (const fixedPrice of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      service.create(businessA, product.id, { pricingType: "fixed", currency: "CLP", fixedPrice }),
      hasAppError("INVALID_MONEY_AMOUNT", 400),
    );
  }
});

test("fixed pricing requires only fixedPrice", async () => {
  const { products, service } = createService();
  const product = products.add(businessA);
  await assert.rejects(
    service.create(businessA, product.id, { pricingType: "fixed", currency: "CLP" }),
    hasAppError("INVALID_PRICE_CONFIGURATION", 400),
  );
  await assert.rejects(
    service.create(businessA, product.id, {
      pricingType: "fixed", currency: "CLP", fixedPrice: 100, unitPrice: 1,
    }),
    hasAppError("INVALID_PRICE_CONFIGURATION", 400),
  );
});

test("unit pricing requires only unitPrice", async () => {
  const { products, service } = createService();
  const product = products.add(businessA);
  await assert.rejects(
    service.create(businessA, product.id, { pricingType: "unit", currency: "CLP" }),
    hasAppError("INVALID_PRICE_CONFIGURATION", 400),
  );
  await assert.rejects(
    service.create(businessA, product.id, {
      pricingType: "unit", currency: "CLP", unitPrice: 1, fixedPrice: 100,
    }),
    hasAppError("INVALID_PRICE_CONFIGURATION", 400),
  );
});

test("rejects invalid quantity bounds and inverted ranges", async () => {
  const { products, service } = createService();
  const product = products.add(businessA);
  for (const input of [
    { minQuantity: 0 }, { maxQuantity: -1 }, { minQuantity: 500, maxQuantity: 100 },
  ]) {
    await assert.rejects(
      service.create(businessA, product.id, {
        pricingType: "unit", currency: "CLP", unitPrice: 1, ...input,
      }),
      (error: unknown) => error instanceof AppError &&
        ["INVALID_PRICE_QUANTITY", "INVALID_PRICE_QUANTITY_RANGE"].includes(error.code),
    );
  }
});

test("rejects overlapping and inclusively adjacent active ranges", async () => {
  const { products, service } = createService();
  const product = products.add(businessA);
  await service.create(businessA, product.id, {
    pricingType: "unit", currency: "CLP", unitPrice: 5, minQuantity: 100, maxQuantity: 1000,
  });
  for (const range of [
    { minQuantity: 500, maxQuantity: 2000 },
    { minQuantity: 1000, maxQuantity: 2000 },
  ]) {
    await assert.rejects(
      service.create(businessA, product.id, {
        pricingType: "unit", currency: "CLP", unitPrice: 4, ...range,
      }),
      hasAppError("PRICE_RANGE_CONFLICT", 409),
    );
  }
});

test("allows non-overlapping active ranges", async () => {
  const { products, service } = createService();
  const product = products.add(businessA);
  await service.create(businessA, product.id, {
    pricingType: "unit", currency: "CLP", unitPrice: 5, maxQuantity: 999,
  });
  const next = await service.create(businessA, product.id, {
    pricingType: "unit", currency: "CLP", unitPrice: 4, minQuantity: 1000,
  });
  assert.equal(next.minQuantity, 1000);
});

test("inactive pricing does not cause range conflicts", async () => {
  const { products, service } = createService();
  const product = products.add(businessA);
  const first = await service.create(businessA, product.id, {
    pricingType: "fixed", currency: "CLP", fixedPrice: 1000,
  });
  await service.update(businessA, product.id, first.id, { status: "inactive" });
  const replacement = await service.create(businessA, product.id, {
    pricingType: "fixed", currency: "CLP", fixedPrice: 1200,
  });
  assert.equal(replacement.status, "active");
});

test("rejects a product owned by another business", async () => {
  const { products, service } = createService();
  const product = products.add(businessB);
  await assert.rejects(
    service.create(businessA, product.id, {
      pricingType: "fixed", currency: "CLP", fixedPrice: 1000,
    }),
    hasAppError("PRODUCT_NOT_FOUND", 404),
  );
});

test("returns controlled 404 for a missing price", async () => {
  const { products, service } = createService();
  const product = products.add(businessA);
  await assert.rejects(
    service.getById(businessA, product.id, missingId),
    hasAppError("PRICE_NOT_FOUND", 404),
  );
});

test("operator can read pricing but cannot create or update it", async (t) => {
  const app = await buildOperatorApp();
  t.after(async () => app.close());
  const list = await app.inject({
    method: "GET", url: `/businesses/${businessA}/products/${missingId}/prices`, headers: authHeaders,
  });
  const create = await app.inject({
    method: "POST", url: `/businesses/${businessA}/products/${missingId}/prices`,
    headers: authHeaders, payload: { pricingType: "fixed", currency: "CLP", fixedPrice: 1000 },
  });
  const update = await app.inject({
    method: "PATCH", url: `/businesses/${businessA}/products/${missingId}/prices/${missingId}`,
    headers: authHeaders, payload: { status: "inactive" },
  });
  assert.equal(list.statusCode, 200);
  assert.equal(create.statusCode, 403);
  assert.equal(update.statusCode, 403);
});

test("invalid pricing UUID is rejected", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());
  const response = await app.inject({
    method: "GET", url: `/businesses/${businessA}/products/not-a-uuid/prices`,
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "INVALID_REQUEST");
});
