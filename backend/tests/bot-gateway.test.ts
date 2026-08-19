import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "../src/core/errors/app-error.js";
import { BotGatewayService } from "../src/modules/bot-gateway/bot-gateway.service.js";
import type { CategoriesService } from "../src/modules/categories/categories.service.js";
import type { CustomersService } from "../src/modules/customers/customers.service.js";
import type { FulfillmentsService } from "../src/modules/fulfillments/fulfillments.service.js";
import type { OrdersService } from "../src/modules/orders/orders.service.js";
import type { PaymentsService } from "../src/modules/payments/payments.service.js";
import type { PricingService } from "../src/modules/pricing/pricing.service.js";
import type { ProductsService } from "../src/modules/products/products.service.js";
import type { QuotesService } from "../src/modules/quotes/quotes.service.js";

const businessA = "1b6d119f-b7c9-4f6e-b203-35798da9f32b";
const customerA = "f3193784-f634-4d89-adb8-8e97dac7095e";
const categoryA = "bca3e535-c449-4ab3-8329-66b50c30dc26";
const productA = "2434e937-20e5-4b78-a422-b397c8bcba3f";
const productB = "097c28d0-ec18-416d-81a3-0077395d8289";
const quoteA = "59a47c62-c933-46d2-a280-d1a87804a3d8";
const orderA = "91619cf5-fec6-47dc-81b5-a07fbcc600d2";
const orderB = "c60f8e43-95f0-4d3e-ab44-f0facbd0704d";
const itemA = "4460ed59-d34e-4804-ad01-21d48d42a963";
const paymentA = "a1835477-4d08-435a-ad66-1cb0485810ac";
const paymentB = "10c7dd61-bbaf-4eb3-a386-7e25a49b6a7b";
const fulfillmentA = "7338c08f-4186-43eb-90f5-22f8e3d952c0";
const fulfillmentB = "9a2df0b2-5ca7-473b-8e69-a7237f7dcfa7";
const now = "2026-08-19T12:00:00.000Z";

function fixture() {
  const calls: Array<[string, string]> = [];
  const paymentRequests: Array<{
    orderId: string; providerKey: string; idempotencyKey: string | undefined;
  }> = [];
  const customer = {
    id: customerA, businessId: businessA, name: "Juan", phone: "56912345678",
    email: null, status: "active" as const, createdAt: now, updatedAt: now,
  };
  const activeCategory = {
    id: categoryA, businessId: businessA, name: "Instagram", status: "active" as const,
    createdAt: now, updatedAt: now,
  };
  const inactiveCategory = { ...activeCategory, id: crypto.randomUUID(), status: "inactive" as const };
  const activeProduct = {
    id: productA, businessId: businessA, categoryId: categoryA, name: "Followers",
    description: null, type: "service" as const, sku: null, minQuantity: 10,
    maxQuantity: 1000, status: "active" as const, createdAt: now, updatedAt: now,
    providerCost: "must-not-leak",
  };
  const inactiveProduct = { ...activeProduct, id: productB, status: "inactive" as const };
  const price = {
    id: crypto.randomUUID(), businessId: businessA, productId: productA,
    pricingType: "unit" as const, currency: "CLP", fixedPrice: null, unitPrice: 2,
    minQuantity: 10, maxQuantity: 1000, status: "active" as const,
    createdAt: now, updatedAt: now, providerRate: "0.001",
  };
  const inactivePrice = { ...price, id: crypto.randomUUID(), status: "inactive" as const };
  const quote = {
    id: quoteA, businessId: businessA, customerId: customerA, productId: productA,
    quantity: 100, productName: "Followers", currency: "CLP", pricingType: "unit" as const,
    unitPrice: 2, totalPrice: 200, status: "active" as const,
    expiresAt: null, createdAt: now,
  };
  const order = {
    id: orderA, businessId: businessA, customerId: customerA, quoteId: quoteA,
    status: "pending_payment" as const, currency: "CLP", subtotal: 200, total: 200,
    createdAt: now, updatedAt: now,
    items: [{
      id: itemA, businessId: businessA, orderId: orderA, productId: productA,
      productName: "Followers", quantity: 100, pricingType: "unit" as const,
      unitPrice: 2, totalPrice: 200, createdAt: now,
    }],
  };
  const payment = {
    id: paymentA, businessId: businessA, orderId: orderA, providerKey: "mercado_pago",
    providerReferenceId: "internal-preference", providerPaymentId: null,
    status: "pending" as const, amount: 200, currency: "CLP",
    checkoutUrl: "https://checkout.example.com/test", idempotencyKey: "private-key",
    expiresAt: null, approvedAt: null, createdAt: now, updatedAt: now,
  };
  const fulfillment = {
    id: fulfillmentA, businessId: businessA, orderId: orderA, orderItemId: itemA,
    productId: productA, integrationId: crypto.randomUUID(), providerServiceId: crypto.randomUUID(),
    providerKey: "smm_raja", externalServiceId: "321", providerServiceType: "Default",
    quantity: 100, status: "submitted" as const, providerOrderId: "999",
    providerStatusRaw: "Pending", inputData: { link: "private target" },
    providerCharge: "0.001", providerCurrency: "USD", providerRemains: 100,
    providerStartCount: 0, submissionAttemptedAt: now, submittedAt: now,
    lastStatusSyncedAt: null, completedAt: null, createdAt: now, updatedAt: now,
  };

  const gateway = new BotGatewayService(
    ({ resolve: async (businessId: string) => {
      calls.push(["customer", businessId]); return customer;
    } }) as unknown as CustomersService,
    { list: async (businessId: string) => { calls.push(["categories", businessId]);
      return [activeCategory, inactiveCategory]; } } as unknown as CategoriesService,
    {
      list: async (businessId: string) => { calls.push(["products", businessId]);
        return [activeProduct, inactiveProduct]; },
      getById: async (businessId: string, id: string) => {
        calls.push(["product", businessId]);
        if (id === productB) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
        return activeProduct;
      },
    } as unknown as ProductsService,
    { list: async (businessId: string) => { calls.push(["prices", businessId]);
      return [price, inactivePrice]; } } as unknown as PricingService,
    ({ create: async (businessId: string) => {
      calls.push(["quote", businessId]); return quote;
    } }) as unknown as QuotesService,
    {
      create: async (businessId: string) => { calls.push(["order-create", businessId]); return order; },
      getById: async (businessId: string, id: string) => {
        calls.push(["order-get", businessId]);
        if (id === orderB) throw new AppError("Order not found", 404, "ORDER_NOT_FOUND");
        return order;
      },
    } as unknown as OrdersService,
    {
      create: async (
        businessId: string, orderId: string, providerKey: string, idempotencyKey?: string,
      ) => { calls.push(["payment-create", businessId]);
        paymentRequests.push({ orderId, providerKey, idempotencyKey });
        return { payment, created: true }; },
      getById: async (businessId: string, id: string) => {
        calls.push(["payment-get", businessId]);
        if (id === paymentB) throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
        return payment;
      },
    } as unknown as PaymentsService,
    {
      dispatch: async (businessId: string) => { calls.push(["fulfillment-dispatch", businessId]);
        return fulfillment; },
      listByOrder: async (businessId: string) => { calls.push(["fulfillment-list", businessId]);
        return [fulfillment]; },
      getById: async (businessId: string, id: string) => {
        calls.push(["fulfillment-get", businessId]);
        if (id === fulfillmentB) {
          throw new AppError("Fulfillment not found", 404, "FULFILLMENT_NOT_FOUND");
        }
        return fulfillment;
      },
      syncStatus: async (businessId: string) => { calls.push(["fulfillment-sync", businessId]);
        return { ...fulfillment, status: "completed" as const, completedAt: now }; },
    } as unknown as FulfillmentsService,
  );
  return { gateway, calls, paymentRequests };
}

test("Gateway exposes only active commercial catalog DTOs without provider data", async () => {
  const { gateway } = fixture();
  assert.equal((await gateway.listCategories(businessA, {})).length, 1);
  const products = await gateway.listProducts(businessA, {});
  const prices = await gateway.listPrices(businessA, productA, {});
  assert.equal(products.length, 1);
  assert.equal(prices.length, 1);
  const serialized = JSON.stringify({ products, prices });
  for (const forbidden of ["providerCost", "providerRate", "providerService", "rate"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  await assert.rejects(gateway.getProduct(businessA, productB),
    (error: unknown) => error instanceof AppError && error.code === "PRODUCT_NOT_FOUND");
});

test("Gateway commercial flow reuses existing services with credential Business scope", async () => {
  const { gateway, calls, paymentRequests } = fixture();
  const customer = await gateway.resolveCustomer(businessA, { phone: "56912345678" });
  await gateway.listProducts(businessA, {});
  const quote = await gateway.createQuote(businessA, {
    productId: productA, quantity: 100, currency: "CLP", customerId: customer.customerId,
  });
  const order = await gateway.createOrder(businessA, { quoteId: quote.quoteId });
  const outcome = await gateway.createPayment(
    businessA, order.orderId, "mercado_pago", "typebot-request-1",
  );
  assert.equal(outcome.payment.checkoutUrl, "https://checkout.example.com/test");
  assert.deepEqual(paymentRequests, [{
    orderId: orderA, providerKey: "mercado_pago", idempotencyKey: "typebot-request-1",
  }]);
  assert.ok(calls.every(([, scopedBusiness]) => scopedBusiness === businessA));
});

test("payment and fulfillment DTOs omit internal provider fields and sensitive inputs", async () => {
  const { gateway } = fixture();
  const payment = await gateway.getPayment(businessA, paymentA);
  const fulfillment = await gateway.dispatchFulfillment(businessA, orderA, {
    orderItemId: itemA, input: { link: "https://instagram.com/example" },
  });
  assert.deepEqual(Object.keys(payment).sort(), [
    "checkoutUrl", "expiresAt", "orderId", "paymentId", "providerKey", "status",
  ]);
  assert.deepEqual(Object.keys(fulfillment).sort(), [
    "completedAt", "fulfillmentId", "lastStatusSyncedAt", "orderId", "orderItemId",
    "productId", "status", "submittedAt",
  ]);
  const serialized = JSON.stringify({ payment, fulfillment });
  for (const forbidden of [
    "providerReferenceId", "providerPaymentId", "idempotencyKey", "providerCharge",
    "providerOrderId", "inputData", "integrationId", "externalServiceId",
  ]) assert.equal(serialized.includes(forbidden), false);
});

test("Gateway fulfillment delegates paid-state enforcement, reads and syncs without retry", async () => {
  const { gateway } = fixture();
  const listed = await gateway.listFulfillments(businessA, orderA);
  const read = await gateway.getFulfillment(businessA, fulfillmentA);
  const synced = await gateway.syncFulfillment(businessA, fulfillmentA);
  assert.equal(listed[0]?.fulfillmentId, fulfillmentA);
  assert.equal(read.status, "submitted");
  assert.equal(synced.status, "completed");
  assert.equal("retry" in gateway, false);
});

test("Gateway propagates business-scoped not-found results for foreign resource IDs", async () => {
  const { gateway } = fixture();
  for (const [promise, code] of [
    [gateway.getProduct(businessA, productB), "PRODUCT_NOT_FOUND"],
    [gateway.getOrder(businessA, orderB), "ORDER_NOT_FOUND"],
    [gateway.getPayment(businessA, paymentB), "PAYMENT_NOT_FOUND"],
    [gateway.getFulfillment(businessA, fulfillmentB), "FULFILLMENT_NOT_FOUND"],
  ] as const) {
    await assert.rejects(promise,
      (error: unknown) => error instanceof AppError && error.code === code);
  }
});
