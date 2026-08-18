import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";
import { AppError } from "../src/core/errors/app-error.js";
import { sessionCookieName } from "../src/modules/auth/auth.cookie.js";
import type {
  CategoriesRepository,
  Category,
  CategoryListOptions,
  CategoryPersistenceInput,
} from "../src/modules/categories/categories.types.js";
import { ProductsService } from "../src/modules/products/products.service.js";
import type {
  Product,
  ProductListOptions,
  ProductPersistenceInput,
  ProductsRepository,
} from "../src/modules/products/products.types.js";

const businessA = "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68";
const businessB = "9d1b85eb-ecbf-479c-838f-80e53e98c9a8";
const missingProductId = "60878fd4-9a90-4f74-8905-d736c8b6ea11";
const userId = "46f5476a-c7e9-403f-9fff-fc3bb234c8b6";
const membershipId = "273676c0-da1f-47d4-a0a7-15624760233b";
const now = "2026-08-18T12:00:00.000Z";

const testConfig: Env = {
  NODE_ENV: "test",
  PORT: 3_000,
  DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
  LOG_LEVEL: "silent",
  AUTH_SESSION_TTL_HOURS: 168,
};

class MemoryCategoriesRepository implements CategoriesRepository {
  readonly categories: Category[] = [];

  add(businessId: string, name = "Instagram"): Category {
    const category: Category = {
      id: randomUUID(),
      businessId,
      name,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    this.categories.push(category);
    return category;
  }

  async create(businessId: string, input: CategoryPersistenceInput): Promise<Category> {
    return this.add(businessId, input.name);
  }

  async list(businessId: string, _options: CategoryListOptions): Promise<Category[]> {
    return this.categories.filter((category) => category.businessId === businessId);
  }

  async findById(businessId: string, categoryId: string): Promise<Category | null> {
    return (
      this.categories.find(
        (category) => category.businessId === businessId && category.id === categoryId,
      ) ?? null
    );
  }

  async findByName(businessId: string, name: string): Promise<Category | null> {
    return (
      this.categories.find(
        (category) => category.businessId === businessId && category.name === name,
      ) ?? null
    );
  }

  async update(): Promise<Category | null> {
    return null;
  }
}

class MemoryProductsRepository implements ProductsRepository {
  readonly products: Product[] = [];

  async create(businessId: string, input: ProductPersistenceInput): Promise<Product> {
    const product: Product = {
      id: randomUUID(),
      businessId,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.products.push(product);
    return product;
  }

  async list(businessId: string, options: ProductListOptions): Promise<Product[]> {
    return this.products
      .filter(
        (product) =>
          product.businessId === businessId &&
          (options.status === undefined || product.status === options.status) &&
          (options.type === undefined || product.type === options.type) &&
          (options.categoryId === undefined || product.categoryId === options.categoryId),
      )
      .slice(options.offset, options.offset + options.limit);
  }

  async findById(businessId: string, productId: string): Promise<Product | null> {
    return (
      this.products.find(
        (product) => product.businessId === businessId && product.id === productId,
      ) ?? null
    );
  }

  async findBySku(
    businessId: string,
    sku: string,
    excludeProductId?: string,
  ): Promise<Product | null> {
    return (
      this.products.find(
        (product) =>
          product.businessId === businessId &&
          product.id !== excludeProductId &&
          product.sku === sku,
      ) ?? null
    );
  }

  async update(
    businessId: string,
    productId: string,
    input: ProductPersistenceInput,
  ): Promise<Product | null> {
    const index = this.products.findIndex(
      (product) => product.businessId === businessId && product.id === productId,
    );
    const existing = this.products[index];
    if (!existing) return null;
    const product = { ...existing, ...input, updatedAt: now };
    this.products[index] = product;
    return product;
  }
}

function createService(): {
  products: MemoryProductsRepository;
  categories: MemoryCategoriesRepository;
  service: ProductsService;
} {
  const products = new MemoryProductsRepository();
  const categories = new MemoryCategoriesRepository();
  return { products, categories, service: new ProductsService(products, categories) };
}

function hasAppError(code: string, statusCode: number): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

async function buildOperatorApp() {
  const app = await buildApp(testConfig);
  app.authService.authenticate = async () => ({
    id: userId,
    email: "operator@example.com",
    name: "Operator",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  app.membershipsRepository.findByBusinessAndUser = async () => ({
    id: membershipId,
    businessId: businessA,
    userId,
    role: "operator",
    createdAt: now,
    updatedAt: now,
  });
  app.db.query = (async () => ({ rows: [] })) as unknown as typeof app.db.query;
  return app;
}

const authHeaders = { cookie: `${sessionCookieName}=test-session` };

test("creates a service product with a valid business category", async () => {
  const { categories, service } = createService();
  const category = categories.add(businessA);
  const product = await service.create(businessA, {
    categoryId: category.id,
    name: "  Seguidores Instagram Premium  ",
    description: "  Servicio premium  ",
    type: "service",
    sku: " ig-follow-premium ",
    minQuantity: 100,
    maxQuantity: 10_000,
  });

  assert.equal(product.type, "service");
  assert.equal(product.categoryId, category.id);
  assert.equal(product.name, "Seguidores Instagram Premium");
  assert.equal(product.description, "Servicio premium");
  assert.equal(product.sku, "IG-FOLLOW-PREMIUM");
});

test("creates a product type product", async () => {
  const { service } = createService();
  const product = await service.create(businessA, {
    name: "Pack digital",
    type: "product",
    sku: "PACK-001",
  });
  assert.equal(product.type, "product");
});

test("product without category and SKU is allowed", async () => {
  const { service } = createService();
  const product = await service.create(businessA, {
    name: "Consultoría inicial",
    type: "service",
  });
  assert.equal(product.categoryId, null);
  assert.equal(product.sku, null);
});

test("duplicate SKU inside one business returns 409", async () => {
  const { service } = createService();
  await service.create(businessA, { name: "Pack A", type: "product", sku: "pack-001" });

  await assert.rejects(
    service.create(businessA, { name: "Pack B", type: "product", sku: "PACK-001" }),
    hasAppError("PRODUCT_SKU_CONFLICT", 409),
  );
});

test("the same SKU is allowed in different businesses", async () => {
  const { service } = createService();
  const productA = await service.create(businessA, {
    name: "Pack A",
    type: "product",
    sku: "PACK-001",
  });
  const productB = await service.create(businessB, {
    name: "Pack B",
    type: "product",
    sku: "PACK-001",
  });
  assert.notEqual(productA.businessId, productB.businessId);
});

test("minQuantity less than or equal to zero is rejected", async () => {
  const { service } = createService();
  await assert.rejects(
    service.create(businessA, { name: "Service", type: "service", minQuantity: 0 }),
    hasAppError("INVALID_PRODUCT_QUANTITY", 400),
  );
});

test("maxQuantity less than or equal to zero is rejected", async () => {
  const { service } = createService();
  await assert.rejects(
    service.create(businessA, { name: "Service", type: "service", maxQuantity: -1 }),
    hasAppError("INVALID_PRODUCT_QUANTITY", 400),
  );
});

test("maxQuantity lower than minQuantity is rejected", async () => {
  const { service } = createService();
  await assert.rejects(
    service.create(businessA, {
      name: "Service",
      type: "service",
      minQuantity: 5000,
      maxQuantity: 1000,
    }),
    hasAppError("INVALID_PRODUCT_QUANTITY_RANGE", 400),
  );
});

test("category from another business is rejected", async () => {
  const { categories, service } = createService();
  const category = categories.add(businessB);

  await assert.rejects(
    service.create(businessA, {
      categoryId: category.id,
      name: "Service",
      type: "service",
    }),
    hasAppError("CATEGORY_NOT_FOUND", 404),
  );
});

test("PATCH allows categoryId null", async () => {
  const { categories, service } = createService();
  const category = categories.add(businessA);
  const product = await service.create(businessA, {
    categoryId: category.id,
    name: "Service",
    type: "service",
  });

  const updated = await service.update(businessA, product.id, { categoryId: null });
  assert.equal(updated.categoryId, null);
});

test("product from Business A is inaccessible through Business B", async () => {
  const { service } = createService();
  const product = await service.create(businessA, { name: "Service", type: "service" });

  await assert.rejects(
    service.getById(businessB, product.id),
    hasAppError("PRODUCT_NOT_FOUND", 404),
  );
});

test("PATCH preserves quantity invariants", async () => {
  const { service } = createService();
  const product = await service.create(businessA, {
    name: "Service",
    type: "service",
    minQuantity: 100,
    maxQuantity: 1000,
  });

  await assert.rejects(
    service.update(businessA, product.id, { minQuantity: 2000 }),
    hasAppError("INVALID_PRODUCT_QUANTITY_RANGE", 400),
  );
});

test("returns 404 for a nonexistent product", async () => {
  const { service } = createService();
  await assert.rejects(
    service.getById(businessA, missingProductId),
    hasAppError("PRODUCT_NOT_FOUND", 404),
  );
});

test("operator can read products", async (t) => {
  const app = await buildOperatorApp();
  t.after(async () => app.close());
  const response = await app.inject({
    method: "GET",
    url: `/businesses/${businessA}/products`,
    headers: authHeaders,
  });
  assert.equal(response.statusCode, 200);
});

test("operator cannot create a product", async (t) => {
  const app = await buildOperatorApp();
  t.after(async () => app.close());
  const response = await app.inject({
    method: "POST",
    url: `/businesses/${businessA}/products`,
    headers: authHeaders,
    payload: { name: "Service", type: "service" },
  });
  assert.equal(response.statusCode, 403);
});

test("operator cannot update a product", async (t) => {
  const app = await buildOperatorApp();
  t.after(async () => app.close());
  const response = await app.inject({
    method: "PATCH",
    url: `/businesses/${businessA}/products/${missingProductId}`,
    headers: authHeaders,
    payload: { status: "inactive" },
  });
  assert.equal(response.statusCode, 403);
});

test("invalid product status and type are rejected", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());
  const statusResponse = await app.inject({
    method: "PATCH",
    url: `/businesses/${businessA}/products/${missingProductId}`,
    payload: { status: "archived" },
  });
  const typeResponse = await app.inject({
    method: "POST",
    url: `/businesses/${businessA}/products`,
    payload: { name: "Service", type: "subscription" },
  });
  assert.equal(statusResponse.statusCode, 400);
  assert.equal(typeResponse.statusCode, 400);
});

test("invalid product UUID is rejected", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());
  const response = await app.inject({
    method: "GET",
    url: `/businesses/${businessA}/products/not-a-uuid`,
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "INVALID_REQUEST");
});
