import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";
import { AppError } from "../src/core/errors/app-error.js";
import { BusinessesService } from "../src/modules/businesses/businesses.service.js";
import type {
  Business,
  BusinessesRepository,
  UpdateBusinessInput,
} from "../src/modules/businesses/businesses.types.js";

const testConfig: Env = {
  NODE_ENV: "test",
  PORT: 3_000,
  DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
  LOG_LEVEL: "silent",
};

const existingBusiness: Business = {
  id: "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68",
  name: "Full Digital",
  status: "active",
  createdAt: "2026-08-18T12:00:00.000Z",
  updatedAt: "2026-08-18T12:00:00.000Z",
};

function repositoryStub(
  overrides: Partial<BusinessesRepository> = {},
): BusinessesRepository {
  return {
    create: async (name) => ({ ...existingBusiness, name }),
    list: async () => [],
    findById: async () => null,
    update: async (_id: string, _input: UpdateBusinessInput) => null,
    ...overrides,
  };
}

async function withApp(
  run: (app: Awaited<ReturnType<typeof buildApp>>) => Promise<void>,
): Promise<void> {
  const app = await buildApp(testConfig);

  try {
    await run(app);
  } finally {
    await app.close();
  }
}

test("POST /businesses validates the creation body", async () => {
  await withApp(async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/businesses",
      payload: { name: 42 },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
  });
});

test("POST /businesses rejects an empty name", async () => {
  await withApp(async (app) => {
    const response = await app.inject({
      method: "POST",
      url: "/businesses",
      payload: { name: "   " },
    });

    assert.equal(response.statusCode, 400);
  });
});

test("PATCH /businesses/:id rejects an invalid status", async () => {
  await withApp(async (app) => {
    const response = await app.inject({
      method: "PATCH",
      url: `/businesses/${existingBusiness.id}`,
      payload: { status: "archived" },
    });

    assert.equal(response.statusCode, 400);
  });
});

test("GET /businesses/:id rejects an invalid UUID", async () => {
  await withApp(async (app) => {
    const response = await app.inject({ method: "GET", url: "/businesses/not-a-uuid" });

    assert.equal(response.statusCode, 400);
  });
});

test("BusinessesService returns 404 when a business does not exist", async () => {
  const service = new BusinessesService(repositoryStub());

  await assert.rejects(
    service.getById(existingBusiness.id),
    (error: unknown) =>
      error instanceof AppError &&
      error.statusCode === 404 &&
      error.code === "BUSINESS_NOT_FOUND",
  );
});

test("BusinessesService trims a business name before persistence", async () => {
  const service = new BusinessesService(repositoryStub());

  const result = await service.create({ name: "  Full Digital  " });

  assert.equal(result.name, "Full Digital");
});

