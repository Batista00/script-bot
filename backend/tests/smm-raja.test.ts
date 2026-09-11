import assert from "node:assert/strict";
import { test } from "node:test";

import { SmmRajaCatalogAdapter, normalizeSmmRajaBalance, normalizeSmmRajaCatalog, normalizeSmmRajaServices, smmRajaOrderCapabilities } from "../src/integrations/smm-raja/smm-raja.adapter.js";
import { NativeSmmRajaClient, type SmmRajaHttpClient } from "../src/integrations/smm-raja/smm-raja.client.js";
import type { ActiveIntegration } from "../src/modules/integrations/integrations.types.js";
import {
  ProviderCatalogUnavailableError,
  ProviderRequestRejectedError,
  ProviderResponseInvalidError,
  ProviderTemporarilyUnavailableError,
} from "../src/modules/provider-catalog/provider-catalog.adapter.js";
import { catalogBusinessA, catalogIntegrationA } from "./support/provider-catalog-memory.js";

const apiKey = "private-smm-raja-key";

function activeIntegration(credentials: Record<string, string> = { apiKey }): ActiveIntegration {
  return {
    id: catalogIntegrationA,
    businessId: catalogBusinessA,
    providerKey: "smm_raja",
    config: {},
    credentials,
  };
}

test("native client sends the official form-encoded services request", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const client = new NativeSmmRajaClient(async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify([]), { status: 200 });
  });

  const result = await client.listServices(apiKey);

  assert.deepEqual(result, []);
  assert.equal(requestUrl, "https://www.smmraja.com/api/v2");
  assert.equal(requestInit?.method, "POST");
  assert.equal((requestInit?.headers as Record<string, string>)["content-type"],
    "application/x-www-form-urlencoded");
  const form = new URLSearchParams(String(requestInit?.body));
  assert.equal(form.get("action"), "services");
  assert.equal(form.get("key"), apiKey);
});

test("adapter obtains credentials for the correct Business and returns no API key", async () => {
  const businesses: string[] = [];
  const clientKeys: string[] = [];
  const client: SmmRajaHttpClient = {
    listServices: async (key) => {
      clientKeys.push(key);
      return [{
        service: "123", name: "Instagram followers", category: "Instagram",
        type: "Default", rate: "1.2500", min: "10", max: "5000",
      }];
    },
    getBalance: async () => ({ balance: "1.25", currency: "USD" }),
  };
  const adapter = new SmmRajaCatalogAdapter({
    getActiveIntegration: async (businessId: string, providerKey: string) => {
      businesses.push(`${businessId}:${providerKey}`);
      return activeIntegration();
    },
  }, client);

  const services = await adapter.listServices(catalogBusinessA);

  assert.deepEqual(businesses, [`${catalogBusinessA}:smm_raja`]);
  assert.deepEqual(clientKeys, [apiKey]);
  assert.equal(services.services[0]?.rate, "1.2500");
  assert.equal(JSON.stringify(services).includes(apiKey), false);
});

test("normalization preserves decimal strings, min/max, and safe metadata", () => {
  const [service] = normalizeSmmRajaServices([{
    service: 123,
    name: " Followers ",
    category: " Instagram ",
    type: " Default ",
    rate: "0.12500000",
    min: "10",
    max: 1000,
    refill: true,
    apiKey: "must-not-be-stored",
    nested: { authorization: "must-not-be-stored", public: "kept" },
  }]);

  assert.deepEqual(service, {
    externalServiceId: "123",
    name: "Followers",
    category: "Instagram",
    serviceType: "Default",
    rate: "0.12500000",
    rateCurrency: "USD",
    minQuantity: 10,
    maxQuantity: 1000,
    providerDescription: null,
    supportsRefill: true,
    supportsCancel: null,
    orderCapabilities: {
      supported: true,
      required: [{ key: "targetUrl", providerField: "link", type: "url" }],
      optional: [],
      source: "official",
    },
    metadata: { nested: { public: "kept" } },
  });
});

test("provider error payload is classified without exposing its message", () => {
  assert.throws(
    () => normalizeSmmRajaServices({ error: "bad response" }),
    ProviderRequestRejectedError,
  );
});

test("non-list response without a provider error is invalid", () => {
  assert.throws(() => normalizeSmmRajaServices({ services: [] }), ProviderResponseInvalidError);
});

test("invalid individual rates are isolated and reported", () => {
  for (const rate of ["NaN", "Infinity", "-1", "1e3", "arbitrary"]) {
    const result = normalizeSmmRajaCatalog([{
        service: "123", name: "Service", rate, min: "1", max: "2",
      }]);
    assert.equal(result.services.length, 0, String(rate));
    assert.equal(result.rejected, 1, String(rate));
  }
});

test("invalid service IDs and quantity ranges are isolated", () => {
  for (const payload of [
    { service: "0", name: "Service", rate: "1" },
    { service: "invalid id!", name: "Service", rate: "1" },
    { service: "1", name: "Service", rate: "1", min: "20", max: "10" },
    { service: "1", name: "Service", rate: "1", max: "Infinity" },
  ]) {
    const result = normalizeSmmRajaCatalog([payload]);
    assert.equal(result.services.length, 0);
    assert.equal(result.rejectionReasons.invalid_service_record, 1);
  }
});

test("normalization accepts the current Raja opaque IDs and unavailable zero values", () => {
  const services = normalizeSmmRajaServices([
    {
      service: "srv_RAJA-abc123", name: "Package", category: "Instagram",
      type: "Package", rate: "0", min: 0, max: 1,
      description: "Editable provider description",
    },
    {
      service: "srv_second", name: "Followers", category: "Instagram",
      type: "Default", rate: "1.25", min: 100, max: 10_000,
      description: "Another description",
    },
  ]);

  assert.equal(services[0]?.externalServiceId, "srv_RAJA-abc123");
  assert.equal(services[0]?.rate, null);
  assert.equal(services[0]?.minQuantity, null);
  assert.equal(services[0]?.rateCurrency, "USD");
  assert.equal(services[0]?.providerDescription, "Editable provider description");
  assert.equal(services[1]?.minQuantity, 100);
});

test("Raja duplicate service IDs are collapsed deterministically to the first record", () => {
  const result = normalizeSmmRajaCatalog([
    { service: "opaque_same", name: "First", rate: "1", min: "1", max: "10" },
    { service: "opaque_same", name: "Second", rate: "2", min: "2", max: "20" },
  ]);
  assert.equal(result.services.length, 1);
  assert.equal(result.services[0]?.name, "First");
  assert.equal(result.services[0]?.rate, "1");
  assert.equal(result.rejected, 1);
  assert.equal(result.rejectionReasons.duplicate_external_service_id, 1);
});

test("balance preserves a nonnegative decimal string and ISO currency", () => {
  assert.deepEqual(normalizeSmmRajaBalance({ balance: "12.3400", currency: "usd" }), {
    balance: "12.3400", currency: "USD",
  });
  assert.throws(() => normalizeSmmRajaBalance({ error: "invalid key" }),
    ProviderRequestRejectedError);
});

test("LIVE Raja type variants are represented without guessing undocumented order contracts", () => {
  for (const supported of [
    "Default", "Custom Comments", "Package", "Mentions User Followers",
    "Comment Likes", "Subscriptions", "Drip-feed",
  ]) {
    assert.equal(smmRajaOrderCapabilities(supported).supported, true, supported);
  }
  for (const unsupported of [
    "Custom Comments Package", "Invites from Groups", "Mentions",
    "Mentions Custom List", "Mentions Hashtag", "Mentions Media Likers",
    "Mentions with Hashtags", "Poll", "SEO", "Web Traffic",
  ]) {
    const capabilities = smmRajaOrderCapabilities(unsupported);
    assert.equal(capabilities.supported, false, unsupported);
    assert.equal(capabilities.required.length, 0, unsupported);
  }
});

test("native client sends the official balance action", async () => {
  let form: URLSearchParams | undefined;
  const client = new NativeSmmRajaClient(async (_input, init) => {
    form = new URLSearchParams(String(init?.body));
    return new Response('{"balance":"1.50","currency":"USD"}', { status: 200 });
  });
  assert.deepEqual(await client.getBalance(apiKey), { balance: "1.50", currency: "USD" });
  assert.equal(form?.get("action"), "balance");
  assert.equal(form?.get("key"), apiKey);
});

test("non-JSON, non-2xx, and network timeout errors are controlled without secrets", async () => {
  const clients = [
    new NativeSmmRajaClient(async () => new Response("not-json", { status: 200 })),
    new NativeSmmRajaClient(async () => new Response("private provider response", { status: 503 })),
    new NativeSmmRajaClient((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    }), 1),
  ];
  const expected = [
    ProviderResponseInvalidError,
    ProviderTemporarilyUnavailableError,
    ProviderTemporarilyUnavailableError,
  ];
  for (let index = 0; index < clients.length; index += 1) {
    await assert.rejects(clients[index]!.listServices(apiKey), (error: unknown) => {
      assert.ok(error instanceof expected[index]!);
      assert.equal(String(error).includes(apiKey), false);
      assert.equal(String(error).includes("private provider response"), false);
      return true;
    });
  }
});

test("missing or malformed SMM Raja credentials are not exposed", async () => {
  for (const integration of [null, activeIntegration({}), activeIntegration({ apiKey: "" })]) {
    const adapter = new SmmRajaCatalogAdapter({
      getActiveIntegration: async () => integration,
    }, { listServices: async () => [], getBalance: async () => ({}) });
    await assert.rejects(
      adapter.listServices(catalogBusinessA),
      ProviderCatalogUnavailableError,
    );
  }
});
