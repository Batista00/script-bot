import assert from "node:assert/strict";
import { test } from "node:test";

import { businessA, createOrdersService } from "./support/orders-memory.js";

test("order item failure rolls back order and keeps quote active", async () => {
  const { repository, service } = createOrdersService();
  const customer = repository.addCustomer(businessA);
  const quote = repository.addQuote(businessA, { customerId: customer.id });
  repository.failItem = true;

  await assert.rejects(service.create(businessA, { quoteId: quote.id }), /Order item failed/);
  assert.equal(repository.orders.length, 0);
  assert.equal(repository.items.length, 0);
  assert.equal(repository.quotes[0]?.status, "active");
});

test("quote update failure rolls back order and item", async () => {
  const { repository, service } = createOrdersService();
  const customer = repository.addCustomer(businessA);
  const quote = repository.addQuote(businessA, { customerId: customer.id });
  repository.failQuoteUpdate = true;

  await assert.rejects(service.create(businessA, { quoteId: quote.id }), /Quote update failed/);
  assert.equal(repository.orders.length, 0);
  assert.equal(repository.items.length, 0);
  assert.equal(repository.quotes[0]?.status, "active");
});
