import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { buildApp } from "../../src/app.js";
import { createInitialOwner } from "../../src/cli/bootstrap-owner.js";
import type { Env } from "../../src/config/env.js";
import { PostgresBusinessesRepository } from "../../src/modules/businesses/businesses.repository.js";
import type { Business } from "../../src/modules/businesses/businesses.types.js";
import type { Category } from "../../src/modules/categories/categories.types.js";
import type { Customer } from "../../src/modules/customers/customers.types.js";
import { PostgresMembershipsRepository } from "../../src/modules/memberships/memberships.repository.js";
import type { Product } from "../../src/modules/products/products.types.js";
import { PostgresUsersRepository } from "../../src/modules/users/users.repository.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test(
  "bootstrap and businesses flow against PostgreSQL",
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
      NODE_ENV: "test",
      PORT: 3_000,
      DATABASE_URL: testDatabaseUrl,
      LOG_LEVEL: "silent",
      AUTH_SESSION_TTL_HOURS: 168,
    };
    const app = await buildApp(config);
    const businesses = new PostgresBusinessesRepository(app.db);
    const users = new PostgresUsersRepository(app.db);
    const memberships = new PostgresMembershipsRepository(app.db);
    let createdId: string | undefined;
    let seedBusinessId: string | undefined;
    let userId: string | undefined;

    t.after(async () => {
      if (userId) {
        await app.db.query("DELETE FROM users WHERE id = $1", [userId]);
      }
      if (createdId) {
        await app.db.query("DELETE FROM businesses WHERE id = $1", [createdId]);
      }
      if (seedBusinessId) {
        await app.db.query("DELETE FROM businesses WHERE id = $1", [seedBusinessId]);
      }
      await app.close();
    });

    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `integration-${unique}@example.com`;
    const password = "integration-password";
    const bootstrap = await createInitialOwner(
      app.db,
      { businesses, users, memberships },
      {
        businessName: `Seed ${unique}`,
        ownerName: "Integration Owner",
        ownerEmail: email,
        ownerPassword: password,
      },
    );
    seedBusinessId = bootstrap.business.id;
    userId = bootstrap.user.id;
    assert.equal(bootstrap.membership.role, "owner");

    const businessesBeforeRetry = await app.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM businesses",
    );
    await assert.rejects(
      createInitialOwner(
        app.db,
        { businesses, users, memberships },
        {
          businessName: `Rejected ${unique}`,
          ownerName: "Another Owner",
          ownerEmail: `another-${email}`,
          ownerPassword: password,
        },
      ),
      new Error("Bootstrap refused: system already initialized"),
    );
    const businessesAfterRetry = await app.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM businesses",
    );
    assert.equal(
      businessesAfterRetry.rows[0]?.count,
      businessesBeforeRetry.rows[0]?.count,
    );

    const loginResponse = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    assert.equal(loginResponse.statusCode, 200);
    const setCookie = loginResponse.headers["set-cookie"];
    const serializedCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(serializedCookie);
    const cookie = serializedCookie.split(";", 1)[0];

    const createResponse = await app.inject({
      method: "POST",
      url: "/businesses",
      headers: { cookie },
      payload: { name: `Integration Test ${Date.now()}` },
    });
    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json<Business>();
    createdId = created.id;
    assert.equal(created.status, "active");

    const listResponse = await app.inject({
      method: "GET",
      url: "/businesses",
      headers: { cookie },
    });
    assert.equal(listResponse.statusCode, 200);
    assert.ok(listResponse.json<Business[]>().some((business) => business.id === createdId));

    const getResponse = await app.inject({
      method: "GET",
      url: `/businesses/${createdId}`,
      headers: { cookie },
    });
    assert.equal(getResponse.statusCode, 200);
    assert.equal(getResponse.json<Business>().id, createdId);

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/businesses/${createdId}`,
      headers: { cookie },
      payload: { name: "Integration Test Updated", status: "inactive" },
    });
    assert.equal(updateResponse.statusCode, 200);
    assert.equal(updateResponse.json<Business>().name, "Integration Test Updated");
    assert.equal(updateResponse.json<Business>().status, "inactive");

    const customerPhone = "+56 9 1234 5678";
    const createCustomerResponse = await app.inject({
      method: "POST",
      url: `/businesses/${seedBusinessId}/customers`,
      headers: { cookie },
      payload: {
        name: "  Integration Customer  ",
        phone: customerPhone,
        email: "  CUSTOMER@Example.COM  ",
      },
    });
    assert.equal(createCustomerResponse.statusCode, 201);
    const customer = createCustomerResponse.json<Customer>();
    assert.equal(customer.name, "Integration Customer");
    assert.equal(customer.phone, "+56912345678");
    assert.equal(customer.email, "customer@example.com");

    const duplicatePhoneResponse = await app.inject({
      method: "POST",
      url: `/businesses/${seedBusinessId}/customers`,
      headers: { cookie },
      payload: { phone: customerPhone },
    });
    assert.equal(duplicatePhoneResponse.statusCode, 409);

    const duplicateEmailResponse = await app.inject({
      method: "POST",
      url: `/businesses/${seedBusinessId}/customers`,
      headers: { cookie },
      payload: { email: "CUSTOMER@EXAMPLE.COM" },
    });
    assert.equal(duplicateEmailResponse.statusCode, 409);

    const otherBusinessCustomerResponse = await app.inject({
      method: "POST",
      url: `/businesses/${createdId}/customers`,
      headers: { cookie },
      payload: { phone: customerPhone },
    });
    assert.equal(otherBusinessCustomerResponse.statusCode, 201);

    const listCustomersResponse = await app.inject({
      method: "GET",
      url: `/businesses/${seedBusinessId}/customers?limit=10&offset=0`,
      headers: { cookie },
    });
    assert.equal(listCustomersResponse.statusCode, 200);
    assert.ok(
      listCustomersResponse
        .json<Customer[]>()
        .some((listedCustomer) => listedCustomer.id === customer.id),
    );

    const getCustomerResponse = await app.inject({
      method: "GET",
      url: `/businesses/${seedBusinessId}/customers/${customer.id}`,
      headers: { cookie },
    });
    assert.equal(getCustomerResponse.statusCode, 200);

    const wrongBusinessResponse = await app.inject({
      method: "GET",
      url: `/businesses/${createdId}/customers/${customer.id}`,
      headers: { cookie },
    });
    assert.equal(wrongBusinessResponse.statusCode, 404);

    const updateCustomerResponse = await app.inject({
      method: "PATCH",
      url: `/businesses/${seedBusinessId}/customers/${customer.id}`,
      headers: { cookie },
      payload: { phone: null, status: "inactive" },
    });
    assert.equal(updateCustomerResponse.statusCode, 200);
    assert.equal(updateCustomerResponse.json<Customer>().phone, null);
    assert.equal(updateCustomerResponse.json<Customer>().status, "inactive");

    const removeLastContactResponse = await app.inject({
      method: "PATCH",
      url: `/businesses/${seedBusinessId}/customers/${customer.id}`,
      headers: { cookie },
      payload: { email: null },
    });
    assert.equal(removeLastContactResponse.statusCode, 400);

    const createCategoryResponse = await app.inject({
      method: "POST",
      url: `/businesses/${seedBusinessId}/categories`,
      headers: { cookie },
      payload: { name: "  Instagram  " },
    });
    assert.equal(createCategoryResponse.statusCode, 201);
    const category = createCategoryResponse.json<Category>();
    assert.equal(category.name, "Instagram");

    const duplicateCategoryResponse = await app.inject({
      method: "POST",
      url: `/businesses/${seedBusinessId}/categories`,
      headers: { cookie },
      payload: { name: "INSTAGRAM" },
    });
    assert.equal(duplicateCategoryResponse.statusCode, 409);

    const otherBusinessCategoryResponse = await app.inject({
      method: "POST",
      url: `/businesses/${createdId}/categories`,
      headers: { cookie },
      payload: { name: "Instagram" },
    });
    assert.equal(otherBusinessCategoryResponse.statusCode, 201);

    const listCategoriesResponse = await app.inject({
      method: "GET",
      url: `/businesses/${seedBusinessId}/categories?limit=10&offset=0&status=active`,
      headers: { cookie },
    });
    assert.equal(listCategoriesResponse.statusCode, 200);
    assert.ok(
      listCategoriesResponse
        .json<Category[]>()
        .some((listedCategory) => listedCategory.id === category.id),
    );

    const wrongBusinessCategoryResponse = await app.inject({
      method: "GET",
      url: `/businesses/${createdId}/categories/${category.id}`,
      headers: { cookie },
    });
    assert.equal(wrongBusinessCategoryResponse.statusCode, 404);

    const updateCategoryResponse = await app.inject({
      method: "PATCH",
      url: `/businesses/${seedBusinessId}/categories/${category.id}`,
      headers: { cookie },
      payload: { status: "inactive" },
    });
    assert.equal(updateCategoryResponse.statusCode, 200);
    assert.equal(updateCategoryResponse.json<Category>().status, "inactive");

    const createProductResponse = await app.inject({
      method: "POST",
      url: `/businesses/${seedBusinessId}/products`,
      headers: { cookie },
      payload: {
        categoryId: category.id,
        name: "  Seguidores Instagram Premium  ",
        description: "  Servicio premium  ",
        type: "service",
        sku: " ig-follow-premium ",
        minQuantity: 100,
        maxQuantity: 10_000,
      },
    });
    assert.equal(createProductResponse.statusCode, 201);
    const product = createProductResponse.json<Product>();
    assert.equal(product.name, "Seguidores Instagram Premium");
    assert.equal(product.sku, "IG-FOLLOW-PREMIUM");
    assert.equal(product.categoryId, category.id);

    const duplicateSkuResponse = await app.inject({
      method: "POST",
      url: `/businesses/${seedBusinessId}/products`,
      headers: { cookie },
      payload: { name: "Duplicate", type: "service", sku: "IG-FOLLOW-PREMIUM" },
    });
    assert.equal(duplicateSkuResponse.statusCode, 409);

    const otherBusinessProductResponse = await app.inject({
      method: "POST",
      url: `/businesses/${createdId}/products`,
      headers: { cookie },
      payload: { name: "Other Business", type: "service", sku: "IG-FOLLOW-PREMIUM" },
    });
    assert.equal(otherBusinessProductResponse.statusCode, 201);

    const crossBusinessCategoryResponse = await app.inject({
      method: "POST",
      url: `/businesses/${createdId}/products`,
      headers: { cookie },
      payload: { categoryId: category.id, name: "Invalid Category", type: "service" },
    });
    assert.equal(crossBusinessCategoryResponse.statusCode, 404);

    const listProductsResponse = await app.inject({
      method: "GET",
      url: `/businesses/${seedBusinessId}/products?limit=10&offset=0&type=service`,
      headers: { cookie },
    });
    assert.equal(listProductsResponse.statusCode, 200);
    assert.ok(
      listProductsResponse
        .json<Product[]>()
        .some((listedProduct) => listedProduct.id === product.id),
    );

    const wrongBusinessProductResponse = await app.inject({
      method: "GET",
      url: `/businesses/${createdId}/products/${product.id}`,
      headers: { cookie },
    });
    assert.equal(wrongBusinessProductResponse.statusCode, 404);

    const updateProductResponse = await app.inject({
      method: "PATCH",
      url: `/businesses/${seedBusinessId}/products/${product.id}`,
      headers: { cookie },
      payload: { categoryId: null, status: "inactive", maxQuantity: 20_000 },
    });
    assert.equal(updateProductResponse.statusCode, 200);
    assert.equal(updateProductResponse.json<Product>().categoryId, null);
    assert.equal(updateProductResponse.json<Product>().status, "inactive");

    const meResponse = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie },
    });
    assert.equal(meResponse.statusCode, 200);

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie },
    });
    assert.equal(logoutResponse.statusCode, 204);

    const invalidatedResponse = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie },
    });
    assert.equal(invalidatedResponse.statusCode, 401);
  },
);
