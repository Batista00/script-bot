import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";
import { AppError } from "../src/core/errors/app-error.js";
import { sessionCookieName } from "../src/modules/auth/auth.cookie.js";
import { CategoriesService } from "../src/modules/categories/categories.service.js";
import type {
  CategoriesRepository,
  Category,
  CategoryListOptions,
  CategoryPersistenceInput,
} from "../src/modules/categories/categories.types.js";

const businessA = "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68";
const businessB = "9d1b85eb-ecbf-479c-838f-80e53e98c9a8";
const missingCategoryId = "60878fd4-9a90-4f74-8905-d736c8b6ea11";
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

  async create(businessId: string, input: CategoryPersistenceInput): Promise<Category> {
    const category: Category = {
      id: randomUUID(),
      businessId,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.categories.push(category);
    return category;
  }

  async list(businessId: string, options: CategoryListOptions): Promise<Category[]> {
    return this.categories
      .filter(
        (category) =>
          category.businessId === businessId &&
          (options.status === undefined || category.status === options.status),
      )
      .slice(options.offset, options.offset + options.limit);
  }

  async findById(businessId: string, categoryId: string): Promise<Category | null> {
    return (
      this.categories.find(
        (category) => category.businessId === businessId && category.id === categoryId,
      ) ?? null
    );
  }

  async findByName(
    businessId: string,
    name: string,
    excludeCategoryId?: string,
  ): Promise<Category | null> {
    return (
      this.categories.find(
        (category) =>
          category.businessId === businessId &&
          category.id !== excludeCategoryId &&
          category.name.toLowerCase() === name.toLowerCase(),
      ) ?? null
    );
  }

  async update(
    businessId: string,
    categoryId: string,
    input: CategoryPersistenceInput,
  ): Promise<Category | null> {
    const index = this.categories.findIndex(
      (category) => category.businessId === businessId && category.id === categoryId,
    );
    const existing = this.categories[index];
    if (!existing) return null;
    const category = { ...existing, ...input, updatedAt: now };
    this.categories[index] = category;
    return category;
  }
}

function createService(): {
  repository: MemoryCategoriesRepository;
  service: CategoriesService;
} {
  const repository = new MemoryCategoriesRepository();
  return { repository, service: new CategoriesService(repository) };
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

test("creates a valid normalized category", async () => {
  const { service } = createService();
  const category = await service.create(businessA, { name: "  Instagram  " });

  assert.equal(category.name, "Instagram");
  assert.equal(category.status, "active");
});

test("rejects an empty category name", async () => {
  const { service } = createService();
  await assert.rejects(
    service.create(businessA, { name: "   " }),
    hasAppError("INVALID_CATEGORY_NAME", 400),
  );
});

test("rejects case-insensitive duplicate category inside one business", async () => {
  const { service } = createService();
  await service.create(businessA, { name: "Instagram" });

  await assert.rejects(
    service.create(businessA, { name: "INSTAGRAM" }),
    hasAppError("CATEGORY_ALREADY_EXISTS", 409),
  );
});

test("allows the same category name in different businesses", async () => {
  const { service } = createService();
  const categoryA = await service.create(businessA, { name: "Instagram" });
  const categoryB = await service.create(businessB, { name: "Instagram" });

  assert.notEqual(categoryA.businessId, categoryB.businessId);
});

test("returns 404 for a nonexistent category", async () => {
  const { service } = createService();
  await assert.rejects(
    service.getById(businessA, missingCategoryId),
    hasAppError("CATEGORY_NOT_FOUND", 404),
  );
});

test("Business A category is inaccessible through Business B", async () => {
  const { service } = createService();
  const category = await service.create(businessA, { name: "Instagram" });

  await assert.rejects(
    service.getById(businessB, category.id),
    hasAppError("CATEGORY_NOT_FOUND", 404),
  );
});

test("operator can read categories", async (t) => {
  const app = await buildOperatorApp();
  t.after(async () => app.close());
  const response = await app.inject({
    method: "GET",
    url: `/businesses/${businessA}/categories`,
    headers: authHeaders,
  });
  assert.equal(response.statusCode, 200);
});

test("operator cannot create a category", async (t) => {
  const app = await buildOperatorApp();
  t.after(async () => app.close());
  const response = await app.inject({
    method: "POST",
    url: `/businesses/${businessA}/categories`,
    headers: authHeaders,
    payload: { name: "Instagram" },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "INSUFFICIENT_BUSINESS_ROLE");
});

test("operator cannot update a category", async (t) => {
  const app = await buildOperatorApp();
  t.after(async () => app.close());
  const response = await app.inject({
    method: "PATCH",
    url: `/businesses/${businessA}/categories/${missingCategoryId}`,
    headers: authHeaders,
    payload: { status: "inactive" },
  });
  assert.equal(response.statusCode, 403);
});

test("invalid category UUID is rejected", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());
  const response = await app.inject({
    method: "GET",
    url: `/businesses/${businessA}/categories/not-a-uuid`,
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "INVALID_REQUEST");
});
