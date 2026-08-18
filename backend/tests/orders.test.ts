import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "../src/core/errors/app-error.js";
import {
  businessA,
  businessB,
  createOrdersService,
  missingId,
} from "./support/orders-memory.js";

function hasAppError(code: string, statusCode: number): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === code && error.statusCode === statusCode;
}

test("creates pending order from quote with its active customer", async () => {
  const { repository, service } = createOrdersService();
  const customer = repository.addCustomer(businessA);
  const quote = repository.addQuote(businessA, { customerId: customer.id });
  const order = await service.create(businessA, { quoteId: quote.id });

  assert.equal(order.customerId, customer.id);
  assert.equal(order.status, "pending_payment");
  assert.equal(order.subtotal, 15_000);
  assert.equal(order.total, 15_000);
  assert.equal(order.items.length, 1);
  assert.equal(repository.quotes[0]?.status, "converted");
});

test("requires a customer only when quote has none", async () => {
  const { repository, service } = createOrdersService();
  const quote = repository.addQuote(businessA);
  await assert.rejects(
    service.create(businessA, { quoteId: quote.id }),
    hasAppError("CUSTOMER_REQUIRED", 400),
  );

  const customer = repository.addCustomer(businessA);
  const order = await service.create(businessA, { quoteId: quote.id, customerId: customer.id });
  assert.equal(order.customerId, customer.id);
});

test("rejects foreign and inactive customers", async () => {
  for (const [customerBusiness, status] of [
    [businessB, "active"],
    [businessA, "inactive"],
  ] as const) {
    const { repository, service } = createOrdersService();
    const quote = repository.addQuote(businessA);
    const customer = repository.addCustomer(customerBusiness, status);
    await assert.rejects(
      service.create(businessA, { quoteId: quote.id, customerId: customer.id }),
      hasAppError("CUSTOMER_NOT_AVAILABLE", 409),
    );
  }
});

test("does not allow replacing the customer fixed by the quote", async () => {
  const { repository, service } = createOrdersService();
  const quoteCustomer = repository.addCustomer(businessA);
  const replacement = repository.addCustomer(businessA);
  const quote = repository.addQuote(businessA, { customerId: quoteCustomer.id });
  await assert.rejects(
    service.create(businessA, { quoteId: quote.id, customerId: replacement.id }),
    hasAppError("CUSTOMER_NOT_AVAILABLE", 409),
  );
});

test("rejects expired quotes without changing their stored status", async () => {
  for (const quoteChanges of [
    { status: "expired" as const },
    { expiresAt: "2026-08-18T11:59:59.000Z" },
  ]) {
    const { repository, service } = createOrdersService();
    const customer = repository.addCustomer(businessA);
    const quote = repository.addQuote(businessA, { customerId: customer.id, ...quoteChanges });
    await assert.rejects(
      service.create(businessA, { quoteId: quote.id }),
      hasAppError("QUOTE_EXPIRED", 409),
    );
    assert.equal(repository.quotes[0]?.status, quoteChanges.status ?? "active");
  }
});

test("rejects cancelled and converted quotes with controlled errors", async () => {
  for (const [status, code] of [
    ["cancelled", "QUOTE_NOT_AVAILABLE"],
    ["converted", "QUOTE_ALREADY_CONVERTED"],
  ] as const) {
    const { repository, service } = createOrdersService();
    const customer = repository.addCustomer(businessA);
    const quote = repository.addQuote(businessA, { customerId: customer.id, status });
    await assert.rejects(service.create(businessA, { quoteId: quote.id }),
      (error: unknown) => error instanceof AppError && error.code === code);
  }
});

test("a quote cannot create two orders", async () => {
  const { repository, service } = createOrdersService();
  const customer = repository.addCustomer(businessA);
  const quote = repository.addQuote(businessA, { customerId: customer.id });
  await service.create(businessA, { quoteId: quote.id });
  await assert.rejects(
    service.create(businessA, { quoteId: quote.id }),
    hasAppError("QUOTE_ALREADY_CONVERTED", 409),
  );
  assert.equal(repository.orders.length, 1);
  assert.equal(repository.items.length, 1);
});

test("order item uses quote snapshot without product or pricing recalculation", async () => {
  const { repository, service } = createOrdersService();
  const customer = repository.addCustomer(businessA);
  const quote = repository.addQuote(businessA, {
    customerId: customer.id,
    productName: "Nombre histórico",
    pricingType: "fixed",
    unitPrice: null,
    quantity: 99,
    totalPrice: 77_777,
  });
  const order = await service.create(businessA, { quoteId: quote.id });
  const item = order.items[0];
  assert.ok(item);
  assert.equal(item.productName, "Nombre histórico");
  assert.equal(item.quantity, 99);
  assert.equal(item.unitPrice, null);
  assert.equal(item.totalPrice, 77_777);
  assert.equal(order.total, 77_777);
});

test("inactive current product cannot block conversion because it is never consulted", async () => {
  const { repository, service } = createOrdersService();
  const customer = repository.addCustomer(businessA);
  const quote = repository.addQuote(businessA, { customerId: customer.id });
  const order = await service.create(businessA, { quoteId: quote.id });
  assert.equal(order.quoteId, quote.id);
});

test("Business A cannot access an order through Business B", async () => {
  const { repository, service } = createOrdersService();
  const customer = repository.addCustomer(businessA);
  const quote = repository.addQuote(businessA, { customerId: customer.id });
  const order = await service.create(businessA, { quoteId: quote.id });
  await assert.rejects(
    service.getById(businessB, order.id),
    hasAppError("ORDER_NOT_FOUND", 404),
  );
});

test("pending order can be cancelled once", async () => {
  const { repository, service } = createOrdersService();
  const customer = repository.addCustomer(businessA);
  const quote = repository.addQuote(businessA, { customerId: customer.id });
  const order = await service.create(businessA, { quoteId: quote.id });
  const cancelled = await service.cancel(businessA, order.id);
  assert.equal(cancelled.status, "cancelled");
  await assert.rejects(
    service.cancel(businessA, order.id),
    hasAppError("ORDER_NOT_CANCELLABLE", 409),
  );
});

test("returns controlled 404 for missing order and quote", async () => {
  const { service } = createOrdersService();
  await assert.rejects(service.getById(businessA, missingId), hasAppError("ORDER_NOT_FOUND", 404));
  await assert.rejects(
    service.create(businessA, { quoteId: missingId }),
    hasAppError("QUOTE_NOT_AVAILABLE", 404),
  );
});
