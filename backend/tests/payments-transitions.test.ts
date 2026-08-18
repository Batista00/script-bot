import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "../src/core/errors/app-error.js";
import {
  createPaymentsService,
  paymentBusinessA,
} from "./support/payments-memory.js";

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === code;
}

test("provider approval atomically marks Payment approved and Order paid", async () => {
  const { repository, provider, service } = createPaymentsService();
  const order = repository.addOrder();
  provider.result = { providerPaymentId: "payment-approval-1", status: "pending" };
  const created = await service.create(paymentBusinessA, order.id, provider.key);
  const approved = await service.applyProviderUpdate(
    paymentBusinessA,
    provider.key,
    "payment-approval-1",
    "approved",
  );
  assert.equal(approved.id, created.payment.id);
  assert.equal(approved.status, "approved");
  assert.equal(repository.orderStatus(order.id), "paid");
});

test("order update failure rolls back the payment approval", async () => {
  const { repository, provider, service } = createPaymentsService();
  const order = repository.addOrder();
  provider.result = { providerPaymentId: "rollback-1", status: "pending" };
  const created = await service.create(paymentBusinessA, order.id, provider.key);
  repository.failMarkOrderPaid = true;
  await assert.rejects(
    service.applyProviderUpdate(paymentBusinessA, provider.key, "rollback-1", "approved"),
    /forced order update failure/,
  );
  assert.equal((await service.getById(paymentBusinessA, created.payment.id)).status, "pending");
  assert.equal(repository.orderStatus(order.id), "pending_payment");
});

test("a second approved Payment for the same Order is rejected", async () => {
  const { repository, provider, service } = createPaymentsService();
  const order = repository.addOrder();
  provider.result = { providerPaymentId: "attempt-1", status: "pending" };
  await service.create(paymentBusinessA, order.id, provider.key);
  provider.result = { providerPaymentId: "attempt-2", status: "pending" };
  await service.create(paymentBusinessA, order.id, provider.key);
  await service.applyProviderUpdate(paymentBusinessA, provider.key, "attempt-1", "approved");
  await assert.rejects(
    service.applyProviderUpdate(paymentBusinessA, provider.key, "attempt-2", "approved"),
    hasCode("PAYMENT_ALREADY_APPROVED"),
  );
  assert.equal(repository.payments.filter((payment) => payment.status === "approved").length, 1);
});

test("terminal states cannot transition but an identical update is idempotent", async () => {
  const { repository, provider, service } = createPaymentsService();
  const order = repository.addOrder();
  provider.result = { providerPaymentId: "terminal-1", status: "pending" };
  await service.create(paymentBusinessA, order.id, provider.key);
  const rejected = await service.applyProviderUpdate(
    paymentBusinessA,
    provider.key,
    "terminal-1",
    "rejected",
  );
  const repeated = await service.applyProviderUpdate(
    paymentBusinessA,
    provider.key,
    "terminal-1",
    "rejected",
  );
  assert.equal(repeated.id, rejected.id);
  assert.equal(repeated.status, "rejected");
  await assert.rejects(
    service.applyProviderUpdate(paymentBusinessA, provider.key, "terminal-1", "approved"),
    hasCode("PAYMENT_INVALID_TRANSITION"),
  );
  assert.equal(repository.orderStatus(order.id), "pending_payment");
});

test("approval verifies the immutable amount and currency snapshot", async () => {
  const { repository, provider, service } = createPaymentsService();
  const order = repository.addOrder();
  provider.result = { providerPaymentId: "tampered-1", status: "pending" };
  const created = await service.create(paymentBusinessA, order.id, provider.key);
  const stored = repository.payments.find((payment) => payment.id === created.payment.id);
  assert.ok(stored);
  stored.amount += 1;
  await assert.rejects(
    service.applyProviderUpdate(paymentBusinessA, provider.key, "tampered-1", "approved"),
    hasCode("ORDER_NOT_PAYABLE"),
  );
  assert.equal(repository.orderStatus(order.id), "pending_payment");
});
