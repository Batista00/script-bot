import assert from "node:assert/strict";
import { test } from "node:test";

import { AppError } from "../src/core/errors/app-error.js";
import {
  ProviderFulfillmentTemporarilyUnavailableError,
  ProviderOrderRejectedError,
  ProviderSubmissionUnknownError,
  type CreateProviderOrderInput,
  type GetProviderOrderStatusInput,
  type ProviderFulfillmentAdapter,
  type ProviderOrderStatusResult,
} from "../src/modules/fulfillments/fulfillments.adapter.js";
import { ProviderFulfillmentRegistry } from "../src/modules/fulfillments/fulfillments.registry.js";
import { FulfillmentsService } from "../src/modules/fulfillments/fulfillments.service.js";
import type { FulfillmentStatus } from "../src/modules/fulfillments/fulfillments.types.js";
import {
  businessA,
  businessB,
  createFulfillmentPool,
  fulfillmentNow,
  integrationA,
  itemA,
  itemB,
  MemoryFulfillmentsRepository,
  orderA,
  orderB,
  productA,
  serviceA,
} from "./support/fulfillments-memory.js";

class FakeAdapter implements ProviderFulfillmentAdapter {
  readonly key = "smm_raja";
  readonly createInputs: CreateProviderOrderInput[] = [];
  readonly statusInputs: GetProviderOrderStatusInput[] = [];
  createError?: Error;
  statusError?: Error;
  createResult = { providerOrderId: "98765" };
  statusResult: ProviderOrderStatusResult = {
    providerOrderId: "98765", providerStatusRaw: "Pending", status: "submitted",
    charge: null, currency: null, remains: null, startCount: null,
  };
  onCreate?: () => Promise<void>;

  async createOrder(input: CreateProviderOrderInput) {
    this.createInputs.push(structuredClone(input));
    await this.onCreate?.();
    if (this.createError) throw this.createError;
    return this.createResult;
  }
  async getOrderStatus(input: GetProviderOrderStatusInput) {
    this.statusInputs.push(structuredClone(input));
    if (this.statusError) throw this.statusError;
    return structuredClone(this.statusResult);
  }
}

function setup() {
  const repository = new MemoryFulfillmentsRepository();
  const adapter = new FakeAdapter();
  const warnings: string[] = [];
  const service = new FulfillmentsService(
    repository,
    createFulfillmentPool(),
    new ProviderFulfillmentRegistry([adapter]),
    () => new Date(fulfillmentNow),
    ({ providerStatusRaw }) => warnings.push(providerStatusRaw),
  );
  return { repository, adapter, warnings, service };
}

async function rejectsCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) =>
    error instanceof AppError && error.code === code);
}

test("only a paid Order with its own business-scoped OrderItem can dispatch", async () => {
  for (const status of ["pending_payment", "processing", "cancelled", "failed", "completed"] as const) {
    const { repository, adapter, service } = setup();
    repository.orders.set(`${businessA}:${orderA}`, status);
    await rejectsCode(service.dispatch(businessA, orderA, {
      orderItemId: itemA, input: { link: "https://instagram.com/example" },
    }), "ORDER_NOT_READY_FOR_FULFILLMENT");
    assert.equal(adapter.createInputs.length, 0);
  }
  for (const [businessId, orderId, orderItemId] of [
    [businessA, orderB, itemA], [businessA, orderA, itemB], [businessB, orderA, itemA],
  ] as const) {
    const { adapter, service } = setup();
    const expected = orderId === orderA && businessId === businessA
      ? "ORDER_ITEM_NOT_FOUND" : "ORDER_NOT_FOUND";
    await rejectsCode(service.dispatch(businessId, orderId, {
      orderItemId, input: { link: "https://instagram.com/example" },
    }), expected);
    assert.equal(adapter.createInputs.length, 0);
  }
});

test("dispatch validates mapping, provider/integration state, and quantity bounds", async () => {
  const cases: Array<[() => ReturnType<typeof setup>, string]> = [
    [() => { const value = setup(); value.repository.providers.clear(); return value; },
      "PRODUCT_PROVIDER_MAPPING_NOT_FOUND"],
    [() => { const value = setup(); value.repository.providers.get(`${businessA}:${productA}`)!
      .providerServiceStatus = "inactive"; return value; }, "PROVIDER_SERVICE_INACTIVE"],
    [() => { const value = setup(); value.repository.providers.get(`${businessA}:${productA}`)!
      .integrationStatus = "inactive"; return value; }, "INTEGRATION_INACTIVE"],
    [() => { const value = setup(); value.repository.providers.get(`${businessA}:${productA}`)!
      .providerMinQuantity = 101; return value; }, "PROVIDER_QUANTITY_NOT_SUPPORTED"],
    [() => { const value = setup(); value.repository.providers.get(`${businessA}:${productA}`)!
      .providerMaxQuantity = 99; return value; }, "PROVIDER_QUANTITY_NOT_SUPPORTED"],
  ];
  for (const [build, code] of cases) {
    const { adapter, service } = build();
    await rejectsCode(service.dispatch(businessA, orderA, {
      orderItemId: itemA, input: { link: "https://instagram.com/example" },
    }), code);
    assert.equal(adapter.createInputs.length, 0);
  }
});

test("dispatch snapshots provider context and uses OrderItem quantity", async () => {
  const { repository, adapter, service } = setup();
  const result = await service.dispatch(businessA, orderA, {
    orderItemId: itemA, input: { link: "https://instagram.com/example" },
  });
  assert.equal(result.status, "submitted");
  assert.equal(result.providerOrderId, "98765");
  assert.equal(repository.orders.get(`${businessA}:${orderA}`), "processing");
  assert.deepEqual(adapter.createInputs[0], {
    businessId: businessA, integrationId: integrationA, externalServiceId: "321",
    serviceType: "Default", quantity: 100,
    fulfillmentInput: { link: "https://instagram.com/example" },
  });
  repository.providers.set(`${businessA}:${productA}`, {
    ...repository.providers.get(`${businessA}:${productA}`)!,
    providerServiceId: "15708645-79a0-4c31-b20d-b099acb10ca7",
    integrationId: "eb55af44-5971-412f-89a9-1b80f9707775",
    externalServiceId: "999",
  });
  const stored = await service.getById(businessA, result.id);
  assert.equal(stored.providerServiceId, serviceA);
  assert.equal(stored.integrationId, integrationA);
  assert.equal(stored.externalServiceId, "321");
});

test("input_data rejects secrets, reserved provider fields, depth, key count, and large values", async () => {
  const invalid = [
    { apiKey: "secret" }, { accessToken: "secret" }, { password: "secret" },
    { authorization: "secret" }, { service: "999" }, { quantity: 999 },
    { a: { b: { c: { d: { e: { f: "too deep" } } } } } },
    Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`k${index}`, index])),
    { link: "x".repeat(10_001) },
  ];
  for (const input of invalid) {
    const { adapter, service } = setup();
    await rejectsCode(service.dispatch(businessA, orderA, { orderItemId: itemA, input }),
      "FULFILLMENT_INPUT_INVALID");
    assert.equal(adapter.createInputs.length, 0);
  }
});

test("concurrent dispatch and later redispatch never create a second provider order", async () => {
  const { repository, adapter, service } = setup();
  let release!: () => void;
  let started!: () => void;
  const providerStarted = new Promise<void>((resolve) => { started = resolve; });
  const providerRelease = new Promise<void>((resolve) => { release = resolve; });
  adapter.onCreate = async () => { started(); await providerRelease; };
  const first = service.dispatch(businessA, orderA, {
    orderItemId: itemA, input: { link: "https://instagram.com/example" },
  });
  await providerStarted;
  await rejectsCode(service.dispatch(businessA, orderA, {
    orderItemId: itemA, input: { link: "https://instagram.com/example" },
  }), "FULFILLMENT_ALREADY_EXISTS");
  release();
  const submitted = await first;
  assert.equal(adapter.createInputs.length, 1);
  await rejectsCode(service.dispatch(businessA, orderA, {
    orderItemId: itemA, input: { link: "https://instagram.com/example" },
  }), "ORDER_NOT_READY_FOR_FULFILLMENT");
  assert.equal(adapter.createInputs.length, 1);
  repository.fulfillments[0]!.status = "completed" as FulfillmentStatus;
  repository.orders.set(`${businessA}:${orderA}`, "completed");
  await rejectsCode(service.dispatch(businessA, orderA, {
    orderItemId: itemA, input: { link: "https://instagram.com/example" },
  }), "ORDER_NOT_READY_FOR_FULFILLMENT");
  assert.equal(adapter.createInputs.length, 1);
});

test("ambiguous create becomes submission_unknown and can never retry", async () => {
  const { repository, adapter, service } = setup();
  adapter.createError = new ProviderSubmissionUnknownError();
  await rejectsCode(service.dispatch(businessA, orderA, {
    orderItemId: itemA, input: { link: "https://instagram.com/example" },
  }), "FULFILLMENT_SUBMISSION_UNKNOWN");
  const fulfillment = repository.fulfillments[0]!;
  assert.equal(fulfillment.status, "submission_unknown");
  assert.equal(repository.orders.get(`${businessA}:${orderA}`), "paid");
  await rejectsCode(service.retry(businessA, fulfillment.id), "FULFILLMENT_SUBMISSION_UNKNOWN");
  assert.equal(adapter.createInputs.length, 1);
});

test("explicit rejection becomes failed and explicit retry reuses the row", async () => {
  const { repository, adapter, service } = setup();
  adapter.createError = new ProviderOrderRejectedError();
  await rejectsCode(service.dispatch(businessA, orderA, {
    orderItemId: itemA, input: { link: "https://instagram.com/example" },
  }), "PROVIDER_ORDER_REJECTED");
  const fulfillment = repository.fulfillments[0]!;
  assert.equal(fulfillment.status, "failed");
  delete adapter.createError;
  const retried = await service.retry(businessA, fulfillment.id);
  assert.equal(retried.id, fulfillment.id);
  assert.equal(retried.status, "submitted");
  assert.equal(adapter.createInputs.length, 2);
});

test("status sync persists raw metrics and drives conservative Order transitions", async () => {
  for (const [providerStatus, expectedOrder] of [
    ["completed", "completed"], ["partial", "failed"], ["cancelled", "failed"],
  ] as const) {
    const { repository, adapter, service } = setup();
    const dispatched = await service.dispatch(businessA, orderA, {
      orderItemId: itemA, input: { link: "https://instagram.com/example" },
    });
    adapter.statusResult = {
      providerOrderId: "98765", providerStatusRaw: providerStatus,
      status: providerStatus, charge: "12.340000000001", currency: "USD",
      remains: 4, startCount: 100,
    };
    const synced = await service.syncStatus(businessA, dispatched.id);
    assert.equal(synced.status, providerStatus);
    assert.equal(synced.providerCharge, "12.340000000001");
    assert.equal(synced.providerCurrency, "USD");
    assert.equal(synced.providerRemains, 4);
    assert.equal(synced.providerStartCount, 100);
    assert.equal(repository.orders.get(`${businessA}:${orderA}`), expectedOrder);
  }
});

test("unknown status only saves raw value; status timeout changes no local state", async () => {
  const { repository, adapter, warnings, service } = setup();
  const dispatched = await service.dispatch(businessA, orderA, {
    orderItemId: itemA, input: { link: "https://instagram.com/example" },
  });
  adapter.statusResult = {
    providerOrderId: "98765", providerStatusRaw: "Waiting for upstream", status: null,
    charge: null, currency: null, remains: null, startCount: null,
  };
  const unknown = await service.syncStatus(businessA, dispatched.id);
  assert.equal(unknown.status, "submitted");
  assert.equal(unknown.providerStatusRaw, "Waiting for upstream");
  assert.deepEqual(warnings, ["Waiting for upstream"]);
  adapter.statusError = new ProviderFulfillmentTemporarilyUnavailableError();
  await rejectsCode(service.syncStatus(businessA, dispatched.id),
    "PROVIDER_TEMPORARILY_UNAVAILABLE");
  assert.equal(repository.fulfillments[0]?.status, "submitted");
  assert.equal(repository.orders.get(`${businessA}:${orderA}`), "processing");
});
