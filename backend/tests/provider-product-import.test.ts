import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import type { Pool } from "pg";

import { AppError } from "../src/core/errors/app-error.js";
import type { CategoriesRepository } from "../src/modules/categories/categories.types.js";
import type { PricingRepository, ProductPrice } from "../src/modules/pricing/pricing.types.js";
import type { ProductsRepository, Product } from "../src/modules/products/products.types.js";
import { ProviderProductImportService } from "../src/modules/provider-catalog/provider-product-import.service.js";
import type { ImportProviderServiceInput } from "../src/modules/provider-catalog/provider-product-import.types.js";
import type {
  ProductProviderMapping,
  ProviderCatalogRepository,
  ProviderService,
} from "../src/modules/provider-catalog/provider-catalog.types.js";

const businessA = "30292e18-abfd-43c1-946d-8e18489a39a5";
const businessB = "e264a25e-4595-45c9-92d8-5a702907323a";
const integrationId = "499aa88d-a044-4a60-b0c0-e463acfe4ac2";
const categoryId = "c1a400ce-5084-4d9e-ab13-ad9399f4ba92";
const now = "2026-08-20T12:00:00.000Z";

test("unsupported service may be imported inactive but never as a sellable product",async()=>{
  const context=setup({orderCapabilities:{supported:false,required:[],optional:[]}});
  // The public setup contract is exercised below through the same service used by existing tests.
  const candidate=providerService();
  await assert.rejects(()=>context.service.import(businessA,input(candidate.id)),{code:"PROVIDER_SERVICE_NOT_SUPPORTED"});
  const imported=await context.service.import(businessA,{...input(candidate.id),status:"inactive"});
  assert.equal(imported.product.status,"inactive");
});

type FailureStage = "product" | "pricing" | "mapping" | undefined;
interface State {
  products: Product[]; prices: ProductPrice[]; mappings: ProductProviderMapping[];
  commands: string[]; failAt: FailureStage; integrationActive: boolean;
}

function providerService(overrides: Partial<ProviderService> = {}): ProviderService {
  return {
    id: "0112b819-6653-4234-821a-6a2fce393c3f", businessId: businessA,
    integrationId, providerKey: "smm_raja", externalServiceId: "123",
    name: "Proveedor seguidores", category: "Instagram", serviceType: "Default",
    rate: "0.15", rateCurrency: null, minQuantity: 100, maxQuantity: 10_000,
    metadata: {}, providerStatus: "active", lastSyncedAt: now,
    orderCapabilities: {supported:true,required:[],optional:[]},
    createdAt: now, updatedAt: now, ...overrides,
  };
}

function input(providerServiceId: string): ImportProviderServiceInput {
  return {
    providerServiceId, name: "Seguidores retail", description: "Oferta comercial",
    categoryId, sku: "IG-RETAIL-001", type: "service", minQuantity: 100,
    maxQuantity: 5_000, currency: "clp", pricingType: "unit",
    retailPrice: 25, status: "active",
  };
}

function setup(serviceOverrides: Partial<ProviderService> = {}, failAt?: FailureStage) {
  const serviceRecord = providerService(serviceOverrides);
  const state: State = {
    products: [], prices: [], mappings: [], commands: [], failAt, integrationActive: true,
  };
  let snapshot: Pick<State, "products" | "prices" | "mappings"> | undefined;
  const client = {
    async query(command: string) {
      state.commands.push(command);
      if (command === "BEGIN") {
        snapshot = structuredClone({
          products: state.products, prices: state.prices, mappings: state.mappings,
        });
      } else if (command === "ROLLBACK" && snapshot) {
        state.products = snapshot.products;
        state.prices = snapshot.prices;
        state.mappings = snapshot.mappings;
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const catalog = {
    findServiceById: async (businessId: string, id: string, executor?: unknown) => {
      assert.equal(executor, client);
      return serviceRecord.businessId === businessId && serviceRecord.id === id
        ? structuredClone(serviceRecord) : null;
    },
    lockActiveIntegration: async (businessId: string, id: string, executor: unknown) => {
      assert.equal(executor, client);
      return state.integrationActive && businessId === businessA && id === integrationId;
    },
    createMapping: async (
      businessId: string, productId: string, providerServiceId: string,
      status: "active" | "inactive", executor?: unknown,
    ) => {
      assert.equal(executor, client);
      if (state.failAt === "mapping") throw new Error("mapping failed");
      const mapping: ProductProviderMapping = {
        id: randomUUID(), businessId, productId, providerServiceId, status,
        createdAt: now, updatedAt: now,
      };
      state.mappings.push(mapping);
      return mapping;
    },
  } as unknown as ProviderCatalogRepository;
  const categories = {
    findById: async (businessId: string, id: string, executor?: unknown) => {
      assert.equal(executor, client);
      return businessId === businessA && id === categoryId
        ? { id, businessId, name: "Instagram", status: "active" as const,
            createdAt: now, updatedAt: now }
        : null;
    },
  } as unknown as CategoriesRepository;
  const products = {
    findBySku: async (_businessId: string, _sku: string, _exclude?: string, executor?: unknown) => {
      assert.equal(executor, client);
      return null;
    },
    create: async (businessId: string, values: Product, executor?: unknown) => {
      assert.equal(executor, client);
      if (state.failAt === "product") throw new Error("product failed");
      const product: Product = {
        ...values, id: randomUUID(), businessId, createdAt: now, updatedAt: now,
      };
      state.products.push(product);
      return product;
    },
  } as unknown as ProductsRepository;
  const pricing = {
    create: async (businessId: string, productId: string, values: ProductPrice, executor?: unknown) => {
      assert.equal(executor, client);
      if (state.failAt === "pricing") throw new Error("pricing failed");
      const price: ProductPrice = {
        ...values, id: randomUUID(), businessId, productId, createdAt: now, updatedAt: now,
      };
      state.prices.push(price);
      return price;
    },
  } as unknown as PricingRepository;
  return {
    state, serviceRecord,
    service: new ProviderProductImportService(pool, catalog, categories, products, pricing),
  };
}

function appError(code: string, status: number) {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === status;
}

test("provider service import atomically creates Product, Pricing and Mapping", async () => {
  const { service, serviceRecord, state } = setup();
  const result = await service.import(businessA, input(serviceRecord.id));
  assert.deepEqual(state.commands, ["BEGIN", "COMMIT"]);
  assert.equal(state.products.length, 1);
  assert.equal(state.prices.length, 1);
  assert.equal(state.mappings.length, 1);
  assert.equal(result.price.productId, result.product.id);
  assert.equal(result.mapping.productId, result.product.id);
  assert.equal(result.mapping.providerServiceId, serviceRecord.id);
  assert.equal(result.price.currency, "CLP");
  assert.equal(result.price.unitPrice, 25);
});

for (const stage of ["product", "pricing", "mapping"] as const) {
  test(`provider service import rolls everything back when ${stage} creation fails`, async () => {
    const { service, serviceRecord, state } = setup({}, stage);
    await assert.rejects(service.import(businessA, input(serviceRecord.id)));
    assert.deepEqual(state.commands, ["BEGIN", "ROLLBACK"]);
    assert.equal(state.products.length, 0);
    assert.equal(state.prices.length, 0);
    assert.equal(state.mappings.length, 0);
  });
}

test("provider service import rejects cross-business service ids", async () => {
  const { service, serviceRecord, state } = setup();
  await assert.rejects(
    service.import(businessB, input(serviceRecord.id)),
    appError("PROVIDER_SERVICE_NOT_FOUND", 404),
  );
  assert.equal(state.products.length, 0);
  assert.deepEqual(state.commands, ["BEGIN", "ROLLBACK"]);
});

test("provider service import rejects inactive provider services", async () => {
  const { service, serviceRecord, state } = setup({ providerStatus: "inactive" });
  await assert.rejects(
    service.import(businessA, input(serviceRecord.id)),
    appError("PROVIDER_SERVICE_INACTIVE", 409),
  );
  assert.equal(state.products.length, 0);
});

test("provider service import rejects an integration deactivated before commit", async () => {
  const { service, serviceRecord, state } = setup();
  state.integrationActive = false;
  await assert.rejects(
    service.import(businessA, input(serviceRecord.id)),
    appError("INTEGRATION_INACTIVE", 409),
  );
  assert.equal(state.products.length, 0);
});
