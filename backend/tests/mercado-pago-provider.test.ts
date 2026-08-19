import assert from "node:assert/strict";
import { test } from "node:test";

import { NativeMercadoPagoClient } from "../src/integrations/mercado-pago/mercado-pago.client.js";
import { MercadoPagoPaymentProvider } from "../src/integrations/mercado-pago/mercado-pago.provider.js";
import {
  type MercadoPagoHttpClient,
  MercadoPagoApiError,
  type MercadoPagoPaymentResource,
  type MercadoPagoPreference,
  type MercadoPagoPreferenceRequest,
} from "../src/integrations/mercado-pago/mercado-pago.types.js";
import type { ActiveIntegration } from "../src/modules/integrations/integrations.types.js";
import type { CreateProviderPaymentInput } from "../src/modules/payments/payments.provider.js";
import { AppError } from "../src/core/errors/app-error.js";
import {
  createPaymentsService,
  paymentBusinessA,
} from "./support/payments-memory.js";

const integrationId = "60878fd4-9a90-4f74-8905-d736c8b6ea11";

class FakeIntegrationsLookup {
  businessIds: string[] = [];
  integration: ActiveIntegration | null = {
    id: integrationId,
    businessId: paymentBusinessA,
    providerKey: "mercado_pago",
    config: {
      successUrl: "https://shop.example/success",
      pendingUrl: "https://shop.example/pending",
      failureUrl: "https://shop.example/failure",
    },
    credentials: { accessToken: "test-access-token", webhookSecret: "test-webhook-secret" },
  };

  async getActiveIntegration(businessId: string): Promise<ActiveIntegration | null> {
    this.businessIds.push(businessId);
    return this.integration;
  }
}

class FakeMercadoPagoClient implements MercadoPagoHttpClient {
  accessTokens: string[] = [];
  preferences: MercadoPagoPreferenceRequest[] = [];
  preference: MercadoPagoPreference = {
    id: "preference-123",
    initPoint: "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=123",
  };
  error: Error | null = null;

  async createPreference(
    accessToken: string,
    input: MercadoPagoPreferenceRequest,
  ): Promise<MercadoPagoPreference> {
    this.accessTokens.push(accessToken);
    this.preferences.push(structuredClone(input));
    if (this.error) throw this.error;
    return this.preference;
  }

  async getPayment(): Promise<MercadoPagoPaymentResource> {
    throw new Error("Not used by provider tests");
  }
}

function providerInput(changes: Partial<CreateProviderPaymentInput> = {}): CreateProviderPaymentInput {
  return {
    businessId: paymentBusinessA,
    paymentId: "2de75f74-c953-462b-a4c7-52f787a0a75e",
    orderId: "e10d0a59-bafb-4538-8c98-9fde8c85ac7a",
    amount: 25_000,
    currency: "CLP",
    customer: {
      id: "9078849c-0336-4759-90e4-8f6493dc5bab",
      name: "Cliente",
      phone: "+56911112222",
      email: null,
    },
    ...changes,
  };
}

test("Mercado Pago provider creates the correct Checkout Pro preference", async () => {
  const integrations = new FakeIntegrationsLookup();
  const client = new FakeMercadoPagoClient();
  const provider = new MercadoPagoPaymentProvider(
    integrations,
    client,
    "https://api.example/base/",
    "production",
  );
  const input = providerInput();
  const result = await provider.createPayment(input);
  const preference = client.preferences[0];
  assert.ok(preference);
  assert.deepEqual(integrations.businessIds, [paymentBusinessA]);
  assert.equal(client.accessTokens[0], "test-access-token");
  assert.equal(preference.external_reference, input.paymentId);
  assert.equal(
    preference.notification_url,
    `https://api.example/base/webhooks/mercado-pago/${integrationId}`,
  );
  assert.deepEqual(preference.items, [{
    id: input.paymentId,
    title: `Order ${input.orderId}`,
    quantity: 1,
    currency_id: "CLP",
    unit_price: 25_000,
  }]);
  assert.deepEqual(preference.back_urls, {
    success: "https://shop.example/success",
    pending: "https://shop.example/pending",
    failure: "https://shop.example/failure",
  });
  assert.deepEqual(result, {
    providerReferenceId: "preference-123",
    status: "pending",
    checkoutUrl: "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=123",
  });
  assert.equal("providerPaymentId" in result, false);
  assert.equal(JSON.stringify(result).includes("test-access-token"), false);
});

test("Payments Core stores preference separately from provider payment id", async () => {
  const integrations = new FakeIntegrationsLookup();
  const client = new FakeMercadoPagoClient();
  const provider = new MercadoPagoPaymentProvider(
    integrations, client, "http://localhost:3000", "test",
  );
  const { repository, service } = createPaymentsService([provider]);
  const order = repository.addOrder();
  const result = await service.create(paymentBusinessA, order.id, provider.key);
  assert.equal(result.payment.providerReferenceId, "preference-123");
  assert.equal(result.payment.providerPaymentId, null);
  assert.equal(result.payment.checkoutUrl, client.preference.initPoint);
  assert.equal(result.payment.status, "pending");
});

test("inactive integration and unsupported currency fail with controlled errors", async () => {
  const integrations = new FakeIntegrationsLookup();
  const client = new FakeMercadoPagoClient();
  const provider = new MercadoPagoPaymentProvider(
    integrations, client, "http://localhost:3000", "test",
  );
  for (const [integration, currency, code] of [
    [null, "CLP", "PAYMENT_PROVIDER_NOT_AVAILABLE"],
    [integrations.integration, "USD", "PAYMENT_PROVIDER_CURRENCY_NOT_SUPPORTED"],
  ] as const) {
    integrations.integration = integration;
    const { repository, service } = createPaymentsService([provider]);
    const order = repository.addOrder(paymentBusinessA, { currency });
    await assert.rejects(
      service.create(paymentBusinessA, order.id, provider.key),
      (error: unknown) => error instanceof AppError && error.code === code,
    );
    assert.equal(repository.payments[0]?.status, "failed");
  }
});

test("Mercado Pago HTTP failure leaves the local Payment failed", async () => {
  const integrations = new FakeIntegrationsLookup();
  const client = new FakeMercadoPagoClient();
  client.error = new MercadoPagoApiError();
  const provider = new MercadoPagoPaymentProvider(
    integrations, client, "http://localhost:3000", "test",
  );
  const { repository, service } = createPaymentsService([provider]);
  const order = repository.addOrder();
  const result = await service.create(paymentBusinessA, order.id, provider.key);
  assert.equal(result.payment.status, "failed");
  assert.equal(repository.orderStatus(order.id), "pending_payment");
});

test("native client sends Bearer token without exposing it in its result", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fakeFetch: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({
      id: "preference-native-1",
      init_point: "https://www.mercadopago.cl/checkout/native",
    }), { status: 201, headers: { "content-type": "application/json" } });
  };
  const client = new NativeMercadoPagoClient(fakeFetch);
  const payload: MercadoPagoPreferenceRequest = {
    items: [{
      id: "payment-id", title: "Order", quantity: 1,
      currency_id: "CLP", unit_price: 1000,
    }],
    external_reference: "payment-id",
    notification_url: "https://api.example/webhook",
  };
  const result = await client.createPreference("native-secret-token", payload);
  assert.equal(requestUrl, "https://api.mercadopago.com/checkout/preferences");
  assert.equal(requestInit?.method, "POST");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer native-secret-token");
  assert.equal(JSON.stringify(result).includes("native-secret-token"), false);
});
