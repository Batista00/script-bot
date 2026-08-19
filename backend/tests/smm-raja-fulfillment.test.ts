import assert from "node:assert/strict";
import { test } from "node:test";

import { SmmRajaFulfillmentAdapter } from "../src/integrations/smm-raja/smm-raja.fulfillment.adapter.js";
import {
  NativeSmmRajaClient,
  type SmmRajaFulfillmentHttpClient,
} from "../src/integrations/smm-raja/smm-raja.client.js";
import {
  ProviderFulfillmentInputError,
  ProviderFulfillmentResponseInvalidError,
  ProviderFulfillmentServiceTypeError,
  ProviderFulfillmentTemporarilyUnavailableError,
  ProviderOrderRejectedError,
  ProviderSubmissionUnknownError,
} from "../src/modules/fulfillments/fulfillments.adapter.js";
import type { ActiveIntegration, JsonObject } from "../src/modules/integrations/integrations.types.js";
import {
  businessA, integrationA,
} from "./support/fulfillments-memory.js";

const apiKey = "private-smm-raja-key";

function integration(): ActiveIntegration {
  return {
    id: integrationA, businessId: businessA, providerKey: "smm_raja",
    config: {}, credentials: { apiKey },
  };
}

function createInput(serviceType: string, fulfillmentInput: JsonObject) {
  return {
    businessId: businessA, integrationId: integrationA, externalServiceId: "321",
    serviceType, quantity: 100, fulfillmentInput,
  };
}

test("native client sends form-encoded action=add and action=status without override", async () => {
  const requests: RequestInit[] = [];
  const client = new NativeSmmRajaClient(async (_input, init) => {
    requests.push(init!);
    const action = new URLSearchParams(String(init?.body)).get("action");
    return new Response(action === "add" ? '{"order":123456}' :
      '{"status":"Pending"}', { status: 200 });
  });
  assert.deepEqual(await client.createOrder(apiKey, "321", {
    link: "https://instagram.com/example", quantity: "100",
  }), { order: 123456 });
  assert.deepEqual(await client.getOrderStatus(apiKey, "123456"), { status: "Pending" });
  for (const request of requests) {
    assert.equal(request.method, "POST");
    assert.equal((request.headers as Record<string, string>)["content-type"],
      "application/x-www-form-urlencoded");
  }
  const add = new URLSearchParams(String(requests[0]?.body));
  assert.equal(add.get("key"), apiKey);
  assert.equal(add.get("action"), "add");
  assert.equal(add.get("service"), "321");
  assert.equal(add.get("quantity"), "100");
  const status = new URLSearchParams(String(requests[1]?.body));
  assert.equal(status.get("key"), apiKey);
  assert.equal(status.get("action"), "status");
  assert.equal(status.get("order"), "123456");
  for (const key of ["key", "action", "service"]) {
    await assert.rejects(client.createOrder(apiKey, "321", { [key]: "override" }),
      ProviderFulfillmentInputError);
  }
});

test("SMM Raja adapter builds each documented service shape exactly", async () => {
  const calls: Array<{ service: string; parameters: Readonly<Record<string, string>> }> = [];
  const client: SmmRajaFulfillmentHttpClient = {
    createOrder: async (_key, service, parameters) => {
      calls.push({ service, parameters });
      return { order: calls.length };
    },
    getOrderStatus: async () => ({ status: "Pending" }),
  };
  const adapter = new SmmRajaFulfillmentAdapter({
    getActiveIntegrationById: async () => integration(),
  }, client);
  const cases: Array<[string, JsonObject, Record<string, string>]> = [
    [" Default ", { link: "https://instagram.com/a" },
      { link: "https://instagram.com/a", quantity: "100" }],
    ["CUSTOM-COMMENTS", { link: "https://instagram.com/a", comments: "one\ntwo" },
      { link: "https://instagram.com/a", comments: "one\ntwo" }],
    ["Mentions_User_Followers", { link: "https://instagram.com/a", username: "alice" },
      { link: "https://instagram.com/a", username: "alice", quantity: "100" }],
    ["Package", { link: "https://instagram.com/a" }, { link: "https://instagram.com/a" }],
    ["Drip-feed", { link: "https://instagram.com/a", runs: 3, interval: 15 },
      { link: "https://instagram.com/a", quantity: "100", runs: "3", interval: "15" }],
    ["Subscriptions", { username: "alice", min: 10, max: 50, posts: 5,
      delay: 0, expiry: "31/12/2026" },
      { username: "alice", min: "10", max: "50", posts: "5", delay: "0",
        expiry: "31/12/2026" }],
    ["Comment Likes", { link: "https://instagram.com/a", username: "alice" },
      { link: "https://instagram.com/a", username: "alice", quantity: "100" }],
  ];
  for (const [type, input, expected] of cases) {
    await adapter.createOrder(createInput(type, input));
    assert.deepEqual(calls.at(-1), { service: "321", parameters: expected });
  }
  assert.ok(calls.every(({ parameters }) => !("key" in parameters) &&
    !("action" in parameters) && !("service" in parameters)));
});

test("unsupported type and invalid provider-specific inputs make no HTTP call", async () => {
  let calls = 0;
  const adapter = new SmmRajaFulfillmentAdapter({
    getActiveIntegrationById: async () => integration(),
  }, {
    createOrder: async () => { calls += 1; return { order: 1 }; },
    getOrderStatus: async () => ({ status: "Pending" }),
  });
  await assert.rejects(adapter.createOrder(createInput("Special", {
    link: "https://instagram.com/a",
  })), ProviderFulfillmentServiceTypeError);
  for (const [type, input] of [
    ["Default", { link: "ftp://invalid", quantity: 999 }],
    ["Custom Comments", { link: "https://instagram.com/a", comments: "" }],
    ["Package", { link: "https://instagram.com/a", username: "unexpected" }],
    ["Drip-feed", { link: "https://instagram.com/a", runs: 0, interval: 10 }],
    ["Subscriptions", { username: "alice", min: 20, max: 10, posts: 1,
      delay: 0, expiry: "2026" }],
  ] as Array<[string, JsonObject]>) {
    await assert.rejects(adapter.createOrder(createInput(type, input)),
      ProviderFulfillmentInputError);
  }
  assert.equal(calls, 0);
});

test("create accepts decimal order IDs, rejects explicit errors, and treats malformed as ambiguous", async () => {
  let response: unknown = { order: "001234" };
  const adapter = new SmmRajaFulfillmentAdapter({
    getActiveIntegrationById: async () => integration(),
  }, {
    createOrder: async () => response,
    getOrderStatus: async () => ({ status: "Pending" }),
  });
  assert.deepEqual(await adapter.createOrder(createInput("Default", {
    link: "https://instagram.com/a",
  })), { providerOrderId: "1234" });
  response = { error: "private provider rejection" };
  await assert.rejects(adapter.createOrder(createInput("Default", {
    link: "https://instagram.com/a",
  })), (error: unknown) => {
    assert.ok(error instanceof ProviderOrderRejectedError);
    assert.equal(String(error).includes("private provider rejection"), false);
    assert.equal(String(error).includes(apiKey), false);
    return true;
  });
  response = { order: "not-decimal" };
  await assert.rejects(adapter.createOrder(createInput("Default", {
    link: "https://instagram.com/a",
  })), ProviderSubmissionUnknownError);
});

test("create transport/non-JSON failures are submission_unknown; status failures are temporary/invalid", async () => {
  const timeoutFetch: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
  });
  for (const client of [
    new NativeSmmRajaClient(async () => new Response("bad", { status: 503 })),
    new NativeSmmRajaClient(async () => new Response("not-json", { status: 200 })),
    new NativeSmmRajaClient(timeoutFetch, 1),
  ]) {
    await assert.rejects(client.createOrder(apiKey, "321", { link: "https://example.com" }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderSubmissionUnknownError);
        assert.equal(String(error).includes(apiKey), false);
        return true;
      });
  }
  await assert.rejects(
    new NativeSmmRajaClient(async () => new Response("bad", { status: 503 }))
      .getOrderStatus(apiKey, "1"),
    ProviderFulfillmentTemporarilyUnavailableError,
  );
  await assert.rejects(
    new NativeSmmRajaClient(async () => new Response("not-json", { status: 200 }))
      .getOrderStatus(apiKey, "1"),
    ProviderFulfillmentResponseInvalidError,
  );
});

test("status mapping is conservative and preserves decimal-string metrics", async () => {
  let response: unknown;
  const adapter = new SmmRajaFulfillmentAdapter({
    getActiveIntegrationById: async () => integration(),
  }, {
    createOrder: async () => ({ order: 1 }),
    getOrderStatus: async () => response,
  });
  for (const [raw, expected] of [
    ["Pending", "submitted"], ["In progress", "in_progress"],
    ["Processing", "in_progress"], ["Completed", "completed"],
    ["Partial", "partial"], ["Canceled", "cancelled"], ["Cancelled", "cancelled"],
    ["Waiting upstream", null],
  ] as const) {
    response = { status: raw, charge: "12.340000000001", currency: "usd",
      remains: "4", start_count: 100 };
    const result = await adapter.getOrderStatus({
      businessId: businessA, integrationId: integrationA, providerOrderId: "1234",
    });
    assert.equal(result.providerStatusRaw, raw);
    assert.equal(result.status, expected);
    assert.equal(result.charge, "12.340000000001");
    assert.equal(result.currency, "USD");
    assert.equal(result.remains, 4);
    assert.equal(result.startCount, 100);
  }
});
