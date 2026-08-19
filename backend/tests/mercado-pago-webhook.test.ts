import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import Fastify from "fastify";

import { mercadoPagoWebhookRoutes } from "../src/integrations/mercado-pago/mercado-pago.webhook.routes.js";
import {
  type MercadoPagoWebhookInput,
  MercadoPagoWebhookService,
} from "../src/integrations/mercado-pago/mercado-pago.webhook.service.js";
import {
  type MercadoPagoHttpClient,
  MercadoPagoApiError,
  type MercadoPagoPaymentResource,
  type MercadoPagoPreferenceRequest,
} from "../src/integrations/mercado-pago/mercado-pago.types.js";
import { registerErrorHandler } from "../src/core/errors/error-handler.js";
import { AppError } from "../src/core/errors/app-error.js";
import type { ActiveIntegration } from "../src/modules/integrations/integrations.types.js";
import type { VerifiedProviderUpdate } from "../src/modules/payments/payments.types.js";
import { FakePaymentProvider } from "./support/payments-memory.js";
import {
  createPaymentsService,
  paymentBusinessA,
  paymentBusinessB,
  paymentMissingId,
} from "./support/payments-memory.js";

const integrationId = "60878fd4-9a90-4f74-8905-d736c8b6ea11";
const webhookSecret = "webhook-fixture-secret";
const requestId = "request-123";
const timestamp = "1704908010";

class FakeWebhookIntegrationLookup {
  integration: ActiveIntegration | null = {
    id: integrationId,
    businessId: paymentBusinessA,
    providerKey: "mercado_pago",
    config: {},
    credentials: { accessToken: "access-token", webhookSecret },
  };

  async getActiveIntegrationById(): Promise<ActiveIntegration | null> {
    return this.integration;
  }
}

class FakeWebhookClient implements MercadoPagoHttpClient {
  paymentIds: string[] = [];
  accessTokens: string[] = [];
  error: Error | null = null;
  resource: MercadoPagoPaymentResource = {
    id: "123456789",
    status: "pending",
    statusDetail: null,
    transactionAmount: 15_000,
    currencyId: "CLP",
    externalReference: paymentMissingId,
  };

  async createPreference(_token: string, _input: MercadoPagoPreferenceRequest): Promise<never> {
    throw new Error("Not used by webhook tests");
  }

  async getPayment(accessToken: string, paymentId: string): Promise<MercadoPagoPaymentResource> {
    this.accessTokens.push(accessToken);
    this.paymentIds.push(paymentId);
    if (this.error) throw this.error;
    return structuredClone(this.resource);
  }
}

class CapturingPayments {
  readonly updates: VerifiedProviderUpdate[] = [];
  async applyVerifiedProviderUpdate(input: VerifiedProviderUpdate) {
    this.updates.push(structuredClone(input));
    return {} as never;
  }
}

function signature(dataId: string, includeRequestId = true): string {
  const manifest = `id:${dataId};${includeRequestId ? `request-id:${requestId};` : ""}ts:${timestamp};`;
  const hash = createHmac("sha256", webhookSecret).update(manifest).digest("hex");
  return `ts=${timestamp},v1=${hash}`;
}

function webhookInput(dataId = "123456789"): MercadoPagoWebhookInput {
  return {
    integrationId,
    type: "payment",
    dataId,
    xRequestId: requestId,
    xSignature: signature(dataId),
  };
}

function hasAppError(code: string, statusCode?: number): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === code &&
    (statusCode === undefined || error.statusCode === statusCode);
}

test("valid webhook queries the real payment and uses its status instead of body status", async () => {
  const integrations = new FakeWebhookIntegrationLookup();
  const client = new FakeWebhookClient();
  const payments = new CapturingPayments();
  client.resource.status = "rejected";
  const service = new MercadoPagoWebhookService(integrations, payments, client);
  const result = await service.process(webhookInput());
  assert.equal(result.processed, true);
  assert.deepEqual(client.paymentIds, ["123456789"]);
  assert.deepEqual(client.accessTokens, ["access-token"]);
  assert.equal(payments.updates[0]?.status, "rejected");
  assert.equal(payments.updates[0]?.providerPaymentId, "123456789");
});

test("missing or invalid signature is rejected before querying Mercado Pago", async () => {
  for (const xSignature of [undefined, "ts=1704908010,v1=invalid"]) {
    const integrations = new FakeWebhookIntegrationLookup();
    const client = new FakeWebhookClient();
    const payments = new CapturingPayments();
    const service = new MercadoPagoWebhookService(integrations, payments, client);
    const input = webhookInput();
    if (xSignature === undefined) delete input.xSignature;
    else input.xSignature = xSignature;
    await assert.rejects(service.process(input), hasAppError("INVALID_WEBHOOK_SIGNATURE", 401));
    assert.equal(client.paymentIds.length, 0);
  }
});

test("webhook without x-request-id validates the manifest with that pair omitted", async () => {
  const integrations = new FakeWebhookIntegrationLookup();
  const client = new FakeWebhookClient();
  const payments = new CapturingPayments();
  const service = new MercadoPagoWebhookService(integrations, payments, client);
  const input = webhookInput();
  delete input.xRequestId;
  input.xSignature = signature(input.dataId, false);
  assert.equal((await service.process(input)).processed, true);
});

test("signed non-payment event is acknowledged without an API call", async () => {
  const integrations = new FakeWebhookIntegrationLookup();
  const client = new FakeWebhookClient();
  const payments = new CapturingPayments();
  const service = new MercadoPagoWebhookService(integrations, payments, client);
  const input = webhookInput();
  input.type = "merchant_order";
  assert.equal((await service.process(input)).processed, false);
  assert.equal(client.paymentIds.length, 0);
  assert.equal(payments.updates.length, 0);
});

test("missing, inactive, or wrong-provider integration is not accepted", async () => {
  for (const reason of ["missing", "inactive", "other-provider"]) {
    const integrations = new FakeWebhookIntegrationLookup();
    integrations.integration = null;
    const service = new MercadoPagoWebhookService(
      integrations,
      new CapturingPayments(),
      new FakeWebhookClient(),
    );
    await assert.rejects(
      service.process(webhookInput()),
      hasAppError("INTEGRATION_NOT_FOUND", 404),
      reason,
    );
  }
});

test("approved webhook binds payment id and atomically pays Order, idempotently", async () => {
  const provider = new FakePaymentProvider("mercado_pago");
  provider.result = { providerReferenceId: "preference-webhook", status: "pending" };
  const setup = createPaymentsService([provider]);
  const order = setup.repository.addOrder();
  const created = await setup.service.create(paymentBusinessA, order.id, provider.key);
  const integrations = new FakeWebhookIntegrationLookup();
  const client = new FakeWebhookClient();
  client.resource = {
    id: "777777777",
    status: "approved",
    statusDetail: "accredited",
    transactionAmount: created.payment.amount,
    currencyId: created.payment.currency,
    externalReference: created.payment.id,
  };
  const service = new MercadoPagoWebhookService(integrations, setup.service, client);
  const input = webhookInput(client.resource.id);
  await service.process(input);
  await service.process(input);
  const payment = await setup.service.getById(paymentBusinessA, created.payment.id);
  assert.equal(payment.providerReferenceId, "preference-webhook");
  assert.equal(payment.providerPaymentId, "777777777");
  assert.equal(payment.status, "approved");
  assert.equal(setup.repository.orderStatus(order.id), "paid");
});

test("pending webhook binds provider payment id without changing local status", async () => {
  const provider = new FakePaymentProvider("mercado_pago");
  provider.result = { providerReferenceId: "preference-pending", status: "pending" };
  const setup = createPaymentsService([provider]);
  const order = setup.repository.addOrder();
  const created = await setup.service.create(paymentBusinessA, order.id, provider.key);
  const client = new FakeWebhookClient();
  client.resource = {
    ...client.resource,
    id: "888888888",
    externalReference: created.payment.id,
  };
  const service = new MercadoPagoWebhookService(
    new FakeWebhookIntegrationLookup(), setup.service, client,
  );
  await service.process(webhookInput(client.resource.id));
  const payment = await setup.service.getById(paymentBusinessA, created.payment.id);
  assert.equal(payment.status, "pending");
  assert.equal(payment.providerPaymentId, "888888888");
  assert.equal(setup.repository.orderStatus(order.id), "pending_payment");
});

test("amount or currency mismatch never approves Payment or Order", async () => {
  for (const mismatch of ["amount", "currency"] as const) {
    const provider = new FakePaymentProvider("mercado_pago");
    provider.result = { providerReferenceId: `preference-${mismatch}`, status: "pending" };
    const setup = createPaymentsService([provider]);
    const order = setup.repository.addOrder();
    const created = await setup.service.create(paymentBusinessA, order.id, provider.key);
    const client = new FakeWebhookClient();
    client.resource = {
      ...client.resource,
      id: mismatch === "amount" ? "900000001" : "900000002",
      status: "approved",
      transactionAmount: mismatch === "amount" ? created.payment.amount + 1 : created.payment.amount,
      currencyId: mismatch === "currency" ? "USD" : created.payment.currency,
      externalReference: created.payment.id,
    };
    const service = new MercadoPagoWebhookService(
      new FakeWebhookIntegrationLookup(), setup.service, client,
    );
    await assert.rejects(
      service.process(webhookInput(client.resource.id)),
      hasAppError(mismatch === "amount" ? "PAYMENT_AMOUNT_MISMATCH" : "PAYMENT_CURRENCY_MISMATCH"),
    );
    assert.equal((await setup.service.getById(paymentBusinessA, created.payment.id)).status, "pending");
    assert.equal(setup.repository.orderStatus(order.id), "pending_payment");
  }
});

test("unknown and cross-business external references cannot update a Payment", async () => {
  for (const [integrationBusiness, paymentBusiness] of [
    [paymentBusinessA, paymentBusinessA],
    [paymentBusinessA, paymentBusinessB],
  ] as const) {
    const provider = new FakePaymentProvider("mercado_pago");
    provider.result = { providerReferenceId: "preference-scope", status: "pending" };
    const setup = createPaymentsService([provider]);
    const externalReference = paymentBusiness === paymentBusinessA
      ? paymentMissingId
      : (await setup.service.create(
          paymentBusinessB,
          setup.repository.addOrder(paymentBusinessB).id,
          provider.key,
        )).payment.id;
    const integrations = new FakeWebhookIntegrationLookup();
    if (integrations.integration) {
      integrations.integration.businessId = integrationBusiness;
    }
    const client = new FakeWebhookClient();
    client.resource = { ...client.resource, externalReference };
    const service = new MercadoPagoWebhookService(integrations, setup.service, client);
    await assert.rejects(service.process(webhookInput()), hasAppError("PAYMENT_NOT_FOUND", 404));
  }
});

test("attempting to replace a bound provider payment id is rejected", async () => {
  const provider = new FakePaymentProvider("mercado_pago");
  provider.result = { providerReferenceId: "preference-bound", status: "pending" };
  const setup = createPaymentsService([provider]);
  const order = setup.repository.addOrder();
  const created = await setup.service.create(paymentBusinessA, order.id, provider.key);
  const client = new FakeWebhookClient();
  client.resource = { ...client.resource, id: "111111111", externalReference: created.payment.id };
  const service = new MercadoPagoWebhookService(
    new FakeWebhookIntegrationLookup(), setup.service, client,
  );
  await service.process(webhookInput("111111111"));
  client.resource.id = "222222222";
  await assert.rejects(
    service.process(webhookInput("222222222")),
    hasAppError("PAYMENT_INVALID_TRANSITION", 409),
  );
});

test("unsupported status is warned without inventing a transition", async () => {
  const client = new FakeWebhookClient();
  client.resource.status = "refunded";
  const warnings: string[] = [];
  const payments = new CapturingPayments();
  const service = new MercadoPagoWebhookService(
    new FakeWebhookIntegrationLookup(),
    payments,
    client,
    (details) => warnings.push(details.providerStatus),
  );
  assert.equal((await service.process(webhookInput())).processed, false);
  assert.deepEqual(warnings, ["refunded"]);
  assert.equal(payments.updates.length, 0);
});

test("temporary Mercado Pago API failure returns a retryable 503", async () => {
  const client = new FakeWebhookClient();
  client.error = new MercadoPagoApiError();
  const service = new MercadoPagoWebhookService(
    new FakeWebhookIntegrationLookup(), new CapturingPayments(), client,
  );
  await assert.rejects(
    service.process(webhookInput()),
    hasAppError("PAYMENT_PROVIDER_TEMPORARILY_UNAVAILABLE", 503),
  );
});

test("public webhook returns 401 for bad signature and 400 for invalid data.id", async (t) => {
  const service = new MercadoPagoWebhookService(
    new FakeWebhookIntegrationLookup(), new CapturingPayments(), new FakeWebhookClient(),
  );
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(mercadoPagoWebhookRoutes, { service });
  t.after(async () => app.close());
  const invalidSignature = await app.inject({
    method: "POST",
    url: `/webhooks/mercado-pago/${integrationId}?data.id=123456789&type=payment`,
    headers: { "x-signature": "ts=1704908010,v1=invalid" },
    payload: { status: "approved" },
  });
  const invalidData = await app.inject({
    method: "POST",
    url: `/webhooks/mercado-pago/${integrationId}?data.id=not-valid&type=payment`,
    payload: {},
  });
  assert.equal(invalidSignature.statusCode, 401);
  assert.equal(invalidData.statusCode, 400);
});
