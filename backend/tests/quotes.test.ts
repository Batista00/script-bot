import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";
import { AppError } from "../src/core/errors/app-error.js";
import type {
  Customer,
  CustomerContact,
  CustomerContactConflict,
  CustomerListOptions,
  CustomerPersistenceInput,
  CustomersRepository,
} from "../src/modules/customers/customers.types.js";
import { PriceCalculatorService } from "../src/modules/pricing/price-calculator.service.js";
import type {
  PricingRepository,
  ProductPrice,
  ProductPriceListOptions,
  ProductPricePersistenceInput,
} from "../src/modules/pricing/pricing.types.js";
import { QuotesService } from "../src/modules/quotes/quotes.service.js";
import type {
  Quote,
  QuoteListOptions,
  QuotePersistenceInput,
  QuotesRepository,
} from "../src/modules/quotes/quotes.types.js";
import type {
  Product,
  ProductListOptions,
  ProductPersistenceInput,
  ProductsRepository,
} from "../src/modules/products/products.types.js";

const businessA = "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68";
const businessB = "9d1b85eb-ecbf-479c-838f-80e53e98c9a8";
const missingId = "60878fd4-9a90-4f74-8905-d736c8b6ea11";
const now = "2026-08-18T12:00:00.000Z";
const currentDate = new Date(now);

const testConfig: Env = {
  NODE_ENV: "test", PORT: 3_000,
  DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
  LOG_LEVEL: "silent", AUTH_SESSION_TTL_HOURS: 168,
};

class MemoryProductsRepository implements ProductsRepository {
  readonly products: Product[] = [];

  add(businessId: string, changes: Partial<Product> = {}): Product {
    const product: Product = {
      id: randomUUID(), businessId, categoryId: null, name: "Seguidores Premium",
      description: null, type: "service", sku: null, minQuantity: null, maxQuantity: null,
      status: "active", createdAt: now, updatedAt: now, ...changes,
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

  add(
    businessId: string,
    productId: string,
    input: Partial<ProductPrice> = {},
  ): ProductPrice {
    const price: ProductPrice = {
      id: randomUUID(), businessId, productId, pricingType: "fixed", currency: "CLP",
      fixedPrice: 15_990, unitPrice: null, minQuantity: null, maxQuantity: null,
      status: "active", createdAt: now, updatedAt: now, ...input,
    };
    this.prices.push(price);
    return price;
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
  async create(
    _businessId: string, _productId: string, _input: ProductPricePersistenceInput,
  ): Promise<ProductPrice> { throw new Error("Not used"); }
  async list(
    _businessId: string, _productId: string, _options: ProductPriceListOptions,
  ): Promise<ProductPrice[]> { return []; }
  async findById(): Promise<ProductPrice | null> { return null; }
  async findActiveRangeConflict(): Promise<ProductPrice | null> { return null; }
  async update(): Promise<ProductPrice | null> { return null; }
}

class MemoryCustomersRepository implements CustomersRepository {
  readonly customers: Customer[] = [];

  add(businessId: string): Customer {
    const customer: Customer = {
      id: randomUUID(), businessId, name: "Customer", phone: "+56912345678", email: null,
      status: "active", createdAt: now, updatedAt: now,
    };
    this.customers.push(customer);
    return customer;
  }
  async findById(businessId: string, customerId: string): Promise<Customer | null> {
    return this.customers.find((item) => item.businessId === businessId && item.id === customerId) ?? null;
  }
  async findByContacts(businessId: string, contact: CustomerContact): Promise<Customer[]> {
    return this.customers.filter((customer) => customer.businessId === businessId &&
      ((contact.phone !== null && customer.phone === contact.phone) ||
       (contact.email !== null && customer.email?.toLowerCase() === contact.email.toLowerCase())));
  }
  async create(_businessId: string, _input: CustomerPersistenceInput): Promise<Customer> {
    throw new Error("Not used");
  }
  async list(_businessId: string, _options: CustomerListOptions): Promise<Customer[]> { return []; }
  async findContactConflict(
    _businessId: string, _contact: CustomerContact, _excludeCustomerId?: string,
  ): Promise<CustomerContactConflict | null> { return null; }
  async update(): Promise<Customer | null> { return null; }
}

class MemoryQuotesRepository implements QuotesRepository {
  readonly quotes: Quote[] = [];

  async create(businessId: string, input: QuotePersistenceInput): Promise<Quote> {
    const quote: Quote = { id: randomUUID(), businessId, ...input, createdAt: now };
    this.quotes.push(quote);
    return { ...quote };
  }
  async list(businessId: string, options: QuoteListOptions): Promise<Quote[]> {
    return this.quotes.filter((quote) => quote.businessId === businessId &&
      (options.customerId === undefined || quote.customerId === options.customerId) &&
      (options.productId === undefined || quote.productId === options.productId))
      .slice(options.offset, options.offset + options.limit).map((quote) => ({ ...quote }));
  }
  async findById(businessId: string, quoteId: string): Promise<Quote | null> {
    const quote = this.quotes.find((item) => item.businessId === businessId && item.id === quoteId);
    return quote ? { ...quote } : null;
  }
}

function createService() {
  const products = new MemoryProductsRepository();
  const prices = new MemoryPricingRepository();
  const customers = new MemoryCustomersRepository();
  const quotes = new MemoryQuotesRepository();
  const calculator = new PriceCalculatorService(products, prices);
  const service = new QuotesService(quotes, calculator, customers, () => currentDate);
  return { products, prices, customers, quotes, service };
}

function hasAppError(code: string, statusCode: number): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

test("creates a correct fixed quote with normalized currency", async () => {
  const { products, prices, service } = createService();
  const product = products.add(businessA);
  prices.add(businessA, product.id);
  const quote = await service.create(businessA, {
    productId: product.id, quantity: 5000, currency: "clp",
  });
  assert.equal(quote.pricingType, "fixed");
  assert.equal(quote.currency, "CLP");
  assert.equal(quote.unitPrice, null);
  assert.equal(quote.totalPrice, 15_990);
});

test("creates a deterministic unit quote", async () => {
  const { products, prices, service } = createService();
  const product = products.add(businessA);
  prices.add(businessA, product.id, {
    pricingType: "unit", fixedPrice: null, unitPrice: 3, minQuantity: 1000,
  });
  const quote = await service.create(businessA, {
    productId: product.id, quantity: 5000, currency: "CLP",
  });
  assert.equal(quote.unitPrice, 3);
  assert.equal(quote.totalPrice, 15_000);
});

test("quote preserves the product name snapshot", async () => {
  const { products, prices, quotes, service } = createService();
  const product = products.add(businessA);
  prices.add(businessA, product.id);
  const created = await service.create(businessA, {
    productId: product.id, quantity: 1, currency: "CLP",
  });
  product.name = "Nombre posterior";
  const persisted = quotes.quotes[0];
  assert.ok(persisted);
  assert.equal(created.productName, "Seguidores Premium");
  assert.equal(persisted.productName, "Seguidores Premium");
});

test("rejects inactive or cross-business products", async () => {
  const { products, prices, service } = createService();
  const inactive = products.add(businessA, { status: "inactive" });
  const foreign = products.add(businessB);
  prices.add(businessA, inactive.id);
  await assert.rejects(
    service.create(businessA, { productId: inactive.id, quantity: 1, currency: "CLP" }),
    hasAppError("PRODUCT_NOT_AVAILABLE", 409),
  );
  await assert.rejects(
    service.create(businessA, { productId: foreign.id, quantity: 1, currency: "CLP" }),
    hasAppError("PRODUCT_NOT_AVAILABLE", 404),
  );
});

test("rejects quantities outside product limits", async () => {
  const { products, prices, service } = createService();
  const product = products.add(businessA, { minQuantity: 100, maxQuantity: 1000 });
  prices.add(businessA, product.id);
  for (const quantity of [99, 1001]) {
    await assert.rejects(
      service.create(businessA, { productId: product.id, quantity, currency: "CLP" }),
      hasAppError("PRODUCT_NOT_AVAILABLE", 409),
    );
  }
});

test("returns controlled error when no active compatible pricing exists", async () => {
  const { products, prices, service } = createService();
  const product = products.add(businessA);
  prices.add(businessA, product.id, { status: "inactive" });
  await assert.rejects(
    service.create(businessA, { productId: product.id, quantity: 1, currency: "CLP" }),
    hasAppError("PRICE_NOT_AVAILABLE", 409),
  );
});

test("accepts an optional valid customer and rejects a foreign customer", async () => {
  const { products, prices, customers, service } = createService();
  const product = products.add(businessA);
  prices.add(businessA, product.id);
  const local = customers.add(businessA);
  const foreign = customers.add(businessB);
  const anonymous = await service.create(businessA, {
    productId: product.id, quantity: 1, currency: "CLP",
  });
  const identified = await service.create(businessA, {
    productId: product.id, quantity: 1, currency: "CLP", customerId: local.id,
  });
  assert.equal(anonymous.customerId, null);
  assert.equal(identified.customerId, local.id);
  await assert.rejects(
    service.create(businessA, {
      productId: product.id, quantity: 1, currency: "CLP", customerId: foreign.id,
    }),
    hasAppError("CUSTOMER_NOT_FOUND", 404),
  );
});

test("a quote is inaccessible from another business", async () => {
  const { products, prices, service } = createService();
  const product = products.add(businessA);
  prices.add(businessA, product.id);
  const quote = await service.create(businessA, {
    productId: product.id, quantity: 1, currency: "CLP",
  });
  await assert.rejects(
    service.getById(businessB, quote.id),
    hasAppError("QUOTE_NOT_FOUND", 404),
  );
});

test("rejects a past expiration", async () => {
  const { products, prices, service } = createService();
  const product = products.add(businessA);
  prices.add(businessA, product.id);
  await assert.rejects(
    service.create(businessA, {
      productId: product.id, quantity: 1, currency: "CLP",
      expiresAt: "2026-08-18T11:59:59.000Z",
    }),
    hasAppError("INVALID_QUOTE_EXPIRATION", 400),
  );
});

test("presents an expired quote without mutating persistence", async () => {
  const { quotes, service } = createService();
  const persisted: Quote = {
    id: randomUUID(), businessId: businessA, customerId: null, productId: randomUUID(),
    quantity: 1, productName: "Snapshot", currency: "CLP", pricingType: "fixed",
    unitPrice: null, totalPrice: 1000, status: "active",
    expiresAt: "2026-08-18T11:59:59.000Z", createdAt: now,
  };
  quotes.quotes.push(persisted);
  const presented = await service.getById(businessA, persisted.id);
  assert.equal(presented.status, "expired");
  assert.equal(quotes.quotes[0]?.status, "active");
});

test("rejects unit price multiplication overflow", async () => {
  const { products, prices, service } = createService();
  const product = products.add(businessA);
  prices.add(businessA, product.id, {
    pricingType: "unit", fixedPrice: null, unitPrice: Number.MAX_SAFE_INTEGER,
  });
  await assert.rejects(
    service.create(businessA, { productId: product.id, quantity: 2, currency: "CLP" }),
    hasAppError("PRICE_OVERFLOW", 400),
  );
});

test("returns controlled 404 for a missing quote", async () => {
  const { service } = createService();
  await assert.rejects(
    service.getById(businessA, missingId),
    hasAppError("QUOTE_NOT_FOUND", 404),
  );
});

test("invalid quote UUID is rejected", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());
  const response = await app.inject({
    method: "GET", url: `/businesses/${businessA}/quotes/not-a-uuid`,
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "INVALID_REQUEST");
});
