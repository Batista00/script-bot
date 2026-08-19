import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { buildApp } from "../src/app.js";
import type { Env } from "../src/config/env.js";
import { AppError } from "../src/core/errors/app-error.js";
import { sessionCookieName } from "../src/modules/auth/auth.cookie.js";
import { CustomersService } from "../src/modules/customers/customers.service.js";
import type {
  Customer,
  CustomerContact,
  CustomerContactConflict,
  CustomerListOptions,
  CustomerPersistenceInput,
  CustomersRepository,
  UpdateCustomerInput,
} from "../src/modules/customers/customers.types.js";
import { CustomerContactConflictError } from "../src/modules/customers/customers.types.js";

const businessA = "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68";
const businessB = "9d1b85eb-ecbf-479c-838f-80e53e98c9a8";
const missingCustomerId = "60878fd4-9a90-4f74-8905-d736c8b6ea11";
const now = "2026-08-18T12:00:00.000Z";

const testConfig: Env = {
  NODE_ENV: "test",
  PORT: 3_000,
  DATABASE_URL: "postgresql://bot:test@localhost:5432/bot_whatsapp",
  LOG_LEVEL: "silent",
  AUTH_SESSION_TTL_HOURS: 168,
};

class MemoryCustomersRepository implements CustomersRepository {
  readonly customers: Customer[] = [];

  async create(businessId: string, input: CustomerPersistenceInput): Promise<Customer> {
    const customer: Customer = {
      id: randomUUID(),
      businessId,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.customers.push(customer);
    return customer;
  }

  async list(businessId: string, options: CustomerListOptions): Promise<Customer[]> {
    return this.customers
      .filter(
        (customer) =>
          customer.businessId === businessId &&
          (options.phone === undefined || customer.phone === options.phone) &&
          (options.email === undefined || customer.email === options.email),
      )
      .slice(options.offset, options.offset + options.limit);
  }

  async findById(businessId: string, customerId: string): Promise<Customer | null> {
    return (
      this.customers.find(
        (customer) => customer.businessId === businessId && customer.id === customerId,
      ) ?? null
    );
  }

  async findByContacts(businessId: string, contact: CustomerContact): Promise<Customer[]> {
    return this.customers.filter((customer) => customer.businessId === businessId &&
      ((contact.phone !== null && customer.phone === contact.phone) ||
       (contact.email !== null && customer.email?.toLowerCase() === contact.email.toLowerCase())));
  }

  async findContactConflict(
    businessId: string,
    contact: CustomerContact,
    excludeCustomerId?: string,
  ): Promise<CustomerContactConflict | null> {
    const candidates = this.customers.filter(
      (customer) => customer.businessId === businessId && customer.id !== excludeCustomerId,
    );
    if (contact.phone && candidates.some((customer) => customer.phone === contact.phone)) {
      return "phone";
    }
    if (
      contact.email &&
      candidates.some((customer) => customer.email?.toLowerCase() === contact.email?.toLowerCase())
    ) {
      return "email";
    }
    return null;
  }

  async update(
    businessId: string,
    customerId: string,
    input: CustomerPersistenceInput,
  ): Promise<Customer | null> {
    const index = this.customers.findIndex(
      (customer) => customer.businessId === businessId && customer.id === customerId,
    );
    const existing = this.customers[index];
    if (!existing) return null;
    const updated: Customer = { ...existing, ...input, updatedAt: now };
    this.customers[index] = updated;
    return updated;
  }
}

function createService(): {
  repository: MemoryCustomersRepository;
  service: CustomersService;
} {
  const repository = new MemoryCustomersRepository();
  return { repository, service: new CustomersService(repository) };
}

function hasAppError(code: string, statusCode: number): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

test("customer with phone is created and presentation formatting is normalized", async () => {
  const { service } = createService();
  const customer = await service.create(businessA, {
    name: "  Juan Pérez  ",
    phone: " +56 (9) 1234-5678 ",
  });

  assert.equal(customer.name, "Juan Pérez");
  assert.equal(customer.phone, "+56912345678");
  assert.equal(customer.email, null);
});

test("customer with email is created and email is normalized", async () => {
  const { service } = createService();
  const customer = await service.create(businessA, {
    email: "  JUAN@Example.COM  ",
  });

  assert.equal(customer.phone, null);
  assert.equal(customer.email, "juan@example.com");
});

test("customer with phone and email is accepted", async () => {
  const { service } = createService();
  const customer = await service.create(businessA, {
    phone: "56912345678",
    email: "juan@example.com",
  });

  assert.equal(customer.phone, "56912345678");
  assert.equal(customer.email, "juan@example.com");
});

test("customer without phone or email is rejected", async () => {
  const { service } = createService();

  await assert.rejects(
    service.create(businessA, { name: "Juan Pérez" }),
    hasAppError("CUSTOMER_CONTACT_REQUIRED", 400),
  );
});

test("nonexistent customer returns 404", async () => {
  const { service } = createService();

  await assert.rejects(
    service.getById(businessA, missingCustomerId),
    hasAppError("CUSTOMER_NOT_FOUND", 404),
  );
});

test("customer from Business A is inaccessible through Business B", async () => {
  const { service } = createService();
  const customer = await service.create(businessA, { phone: "56912345678" });

  await assert.rejects(
    service.getById(businessB, customer.id),
    hasAppError("CUSTOMER_NOT_FOUND", 404),
  );
});

test("duplicate phone inside one business returns 409", async () => {
  const { service } = createService();
  await service.create(businessA, { phone: "+56 9 1234 5678" });

  await assert.rejects(
    service.create(businessA, { phone: "+56912345678" }),
    hasAppError("CUSTOMER_CONTACT_CONFLICT", 409),
  );
});

test("the same phone is allowed in two businesses", async () => {
  const { service } = createService();

  const customerA = await service.create(businessA, { phone: "56912345678" });
  const customerB = await service.create(businessB, { phone: "56912345678" });

  assert.equal(customerA.phone, customerB.phone);
  assert.notEqual(customerA.businessId, customerB.businessId);
});

test("duplicate email is case-insensitive inside one business", async () => {
  const { service } = createService();
  await service.create(businessA, { email: "juan@example.com" });

  await assert.rejects(
    service.create(businessA, { email: "JUAN@EXAMPLE.COM" }),
    hasAppError("CUSTOMER_CONTACT_CONFLICT", 409),
  );
});

test("PATCH cannot leave a customer without contact", async () => {
  const { service } = createService();
  const customer = await service.create(businessA, { phone: "56912345678" });

  await assert.rejects(
    service.update(businessA, customer.id, { phone: null }),
    hasAppError("CUSTOMER_CONTACT_REQUIRED", 400),
  );
});

test("invalid customer status is rejected by HTTP validation", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());

  const response = await app.inject({
    method: "PATCH",
    url: `/businesses/${businessA}/customers/${missingCustomerId}`,
    payload: { status: "archived" } as unknown as UpdateCustomerInput,
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "INVALID_REQUEST");
});

test("invalid business or customer UUID is rejected", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());

  const response = await app.inject({
    method: "GET",
    url: `/businesses/not-a-uuid/customers/${missingCustomerId}`,
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "INVALID_REQUEST");
});

test("authenticated user without membership cannot access customers", async (t) => {
  const app = await buildApp(testConfig);
  t.after(async () => app.close());
  app.authService.authenticate = async () => ({
    id: "46f5476a-c7e9-403f-9fff-fc3bb234c8b6",
    email: "operator@example.com",
    name: "Operator",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  app.membershipsRepository.findByBusinessAndUser = async () => null;

  const response = await app.inject({
    method: "GET",
    url: `/businesses/${businessA}/customers`,
    headers: { cookie: `${sessionCookieName}=test-session` },
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, "BUSINESS_NOT_FOUND");
});

test("customer resolve returns phone/email matches and creates normalized contacts", async () => {
  const { repository, service } = createService();
  const byPhone = await service.create(businessA, { name: "Phone", phone: "+56 9 1111-2222" });
  const byEmail = await service.create(businessA, { name: "Email", email: "USER@example.com" });

  assert.equal((await service.resolve(businessA, { phone: "+56 (9) 1111 2222" })).id, byPhone.id);
  assert.equal((await service.resolve(businessA, { email: " user@EXAMPLE.com " })).id, byEmail.id);
  const created = await service.resolve(businessA, {
    name: "  New Customer ", phone: "56933334444", email: " NEW@example.com ",
  });
  assert.equal(created.name, "New Customer");
  assert.equal(created.email, "new@example.com");
  assert.equal(repository.customers.length, 3);
});

test("customer resolve refuses to merge phone and email owned by different customers", async () => {
  const { service } = createService();
  await service.create(businessA, { phone: "56911112222" });
  await service.create(businessA, { email: "second@example.com" });
  await assert.rejects(
    service.resolve(businessA, { phone: "56911112222", email: "second@example.com" }),
    hasAppError("CUSTOMER_CONTACT_CONFLICT", 409),
  );
});

test("two concurrent equivalent resolves return one Customer", async () => {
  class RacingRepository extends MemoryCustomersRepository {
    private waiting = 0;
    private release!: () => void;
    private readonly both = new Promise<void>((resolve) => { this.release = resolve; });
    override async create(businessId: string, input: CustomerPersistenceInput): Promise<Customer> {
      this.waiting += 1;
      if (this.waiting === 2) this.release();
      await this.both;
      const duplicate = this.customers.find((customer) => customer.businessId === businessId &&
        ((input.phone !== null && customer.phone === input.phone) ||
         (input.email !== null && customer.email === input.email)));
      if (duplicate) throw new CustomerContactConflictError(
        input.phone !== null && duplicate.phone === input.phone ? "phone" : "email",
      );
      return super.create(businessId, input);
    }
  }
  const repository = new RacingRepository();
  const service = new CustomersService(repository);
  const results = await Promise.all([
    service.resolve(businessA, { phone: "+56 9 5555 6666" }),
    service.resolve(businessA, { phone: "+56 9 5555 6666" }),
  ]);
  assert.equal(results[0]?.id, results[1]?.id);
  assert.equal(repository.customers.length, 1);
});
