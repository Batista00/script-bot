import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "../src/core/errors/app-error.js";
import { PaymentProviderRegistry } from "../src/modules/payments/payments.registry.js";
import { PaymentsService } from "../src/modules/payments/payments.service.js";
import {
  createPaymentsService,
  FakePaymentProvider,
  paymentBusinessA,
  paymentBusinessB,
  paymentMissingId,
} from "./support/payments-memory.js";

function hasAppError(code: string, statusCode: number): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === code &&
    error.statusCode === statusCode;
}

test("creates a pending payment from the order snapshot and sends its customer", async () => {
  const { repository, provider, service } = createPaymentsService();
  const order = repository.addOrder(paymentBusinessA, { total: 77_777, currency: "USD" });
  const result = await service.create(paymentBusinessA, order.id, " TEST_PROVIDER ");

  assert.equal(result.created, true);
  assert.equal(result.payment.status, "pending");
  assert.equal(result.payment.amount, 77_777);
  assert.equal(result.payment.currency, "USD");
  assert.equal(result.payment.providerKey, "test_provider");
  assert.equal(provider.calls[0]?.amount, 77_777);
  assert.deepEqual(provider.calls[0]?.customer, order.customer);
});

test("rejects an unavailable provider without creating a local payment", async () => {
  const { repository, service } = createPaymentsService([]);
  const order = repository.addOrder();
  await assert.rejects(
    service.create(paymentBusinessA, order.id, "mercado_pago"),
    hasAppError("PAYMENT_PROVIDER_NOT_AVAILABLE", 503),
  );
  assert.equal(repository.payments.length, 0);
});

test("stores provider checkout details without assuming they are mandatory", async () => {
  const { repository, provider, service } = createPaymentsService();
  const order = repository.addOrder();
  provider.result = {
    providerPaymentId: "checkout-1",
    status: "pending",
    checkoutUrl: "https://payments.example/checkout/1",
    expiresAt: "2026-08-19T12:00:00Z",
  };
  const result = await service.create(paymentBusinessA, order.id, provider.key);
  assert.equal(result.payment.checkoutUrl, "https://payments.example/checkout/1");
  assert.equal(result.payment.expiresAt, "2026-08-19T12:00:00.000Z");
});

test("provider technical failure leaves a failed trace and a payable order", async () => {
  const { repository, provider, service } = createPaymentsService();
  const order = repository.addOrder();
  provider.error = new Error("provider unavailable");
  const result = await service.create(paymentBusinessA, order.id, provider.key);
  assert.equal(result.payment.status, "failed");
  assert.equal(result.payment.providerPaymentId, null);
  assert.equal(repository.orderStatus(order.id), "pending_payment");
});

test("an immediate provider approval uses the core approval transition", async () => {
  const { repository, provider, service } = createPaymentsService();
  const order = repository.addOrder();
  provider.result = { providerPaymentId: "approved-sync-1", status: "approved" };
  const result = await service.create(paymentBusinessA, order.id, provider.key);
  assert.equal(result.payment.status, "approved");
  assert.equal(result.payment.approvedAt, "2026-08-18T12:00:00.000Z");
  assert.equal(repository.orderStatus(order.id), "paid");
});

test("Idempotency-Key returns the original payment without calling provider twice", async () => {
  const { repository, provider, service } = createPaymentsService();
  const order = repository.addOrder();
  const first = await service.create(paymentBusinessA, order.id, provider.key, " key-1 ");
  const repeated = await service.create(paymentBusinessA, order.id, provider.key, "key-1");
  assert.equal(repeated.created, false);
  assert.equal(repeated.payment.id, first.payment.id);
  assert.equal(provider.calls.length, 1);
  assert.equal(repository.payments.length, 1);
});

test("Idempotency-Key conflicts across another order or provider", async () => {
  const primary = new FakePaymentProvider("provider_a");
  const secondary = new FakePaymentProvider("provider_b");
  const setup = createPaymentsService([primary, secondary]);
  const orderA = setup.repository.addOrder();
  const orderB = setup.repository.addOrder();
  await setup.service.create(paymentBusinessA, orderA.id, primary.key, "same-key");

  await assert.rejects(
    setup.service.create(paymentBusinessA, orderB.id, primary.key, "same-key"),
    hasAppError("PAYMENT_IDEMPOTENCY_CONFLICT", 409),
  );
  await assert.rejects(
    setup.service.create(paymentBusinessA, orderA.id, secondary.key, "same-key"),
    hasAppError("PAYMENT_IDEMPOTENCY_CONFLICT", 409),
  );
  assert.equal(setup.repository.payments.length, 1);
});

test("multiple non-approved attempts are allowed for the same order", async () => {
  const { repository, provider, service } = createPaymentsService();
  const order = repository.addOrder();
  provider.result = { providerPaymentId: "rejected-1", status: "rejected" };
  const rejected = await service.create(paymentBusinessA, order.id, provider.key);
  provider.result = { providerPaymentId: "pending-2", status: "pending" };
  const pending = await service.create(paymentBusinessA, order.id, provider.key);
  assert.equal(rejected.payment.status, "rejected");
  assert.equal(pending.payment.status, "pending");
  assert.equal(repository.payments.length, 2);
  assert.equal(repository.orderStatus(order.id), "pending_payment");
});

test("payment reads and lists are business-scoped", async () => {
  const { repository, service } = createPaymentsService();
  const order = repository.addOrder(paymentBusinessA);
  const created = await service.create(paymentBusinessA, order.id, "test_provider");
  await assert.rejects(
    service.getById(paymentBusinessB, created.payment.id),
    hasAppError("PAYMENT_NOT_FOUND", 404),
  );
  assert.deepEqual(await service.list(paymentBusinessB, { limit: 50, offset: 0 }), []);
  assert.deepEqual(
    await service.listByOrder(paymentBusinessB, order.id, { limit: 50, offset: 0 }),
    [],
  );
});

test("returns controlled errors for a missing payment, order, and non-payable order", async () => {
  const { repository, service } = createPaymentsService();
  await assert.rejects(
    service.getById(paymentBusinessA, paymentMissingId),
    hasAppError("PAYMENT_NOT_FOUND", 404),
  );
  await assert.rejects(
    service.create(paymentBusinessA, paymentMissingId, "test_provider"),
    hasAppError("ORDER_NOT_FOUND", 404),
  );
  const paid = repository.addOrder(paymentBusinessA, { status: "paid" });
  await assert.rejects(
    service.create(paymentBusinessA, paid.id, "test_provider"),
    hasAppError("ORDER_NOT_PAYABLE", 409),
  );
});

test("registry validates keys and rejects duplicate providers", () => {
  const first = new FakePaymentProvider("provider_one");
  const duplicate = new FakePaymentProvider("PROVIDER_ONE");
  assert.throws(() => new PaymentProviderRegistry([first, duplicate]), /Duplicate/);
});
