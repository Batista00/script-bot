import assert from "node:assert/strict";
import { test } from "node:test";

import { SmmRajaCatalogAdapter, normalizeSmmRajaServices } from "../src/integrations/smm-raja/smm-raja.adapter.js";
import { NativeSmmRajaClient, type SmmRajaHttpClient } from "../src/integrations/smm-raja/smm-raja.client.js";
import type { ActiveIntegration } from "../src/modules/integrations/integrations.types.js";
import {
  ProviderCatalogUnavailableError,
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
  assert.equal(services[0]?.rate, "1.2500");
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
    rateCurrency: null,
    minQuantity: 10,
    maxQuantity: 1000,
    metadata: { refill: true, nested: { public: "kept" } },
  });
});

test("complete non-list response is invalid", () => {
  assert.throws(
    () => normalizeSmmRajaServices({ error: "bad response" }),
    ProviderResponseInvalidError,
  );
});

test("invalid rate rejects the complete payload", () => {
  for (const rate of ["NaN", "Infinity", "-1", "0", "1e3", "arbitrary"]) {
    assert.throws(
      () => normalizeSmmRajaServices([{
        service: "123", name: "Service", rate, min: "1", max: "2",
      }]),
      ProviderResponseInvalidError,
      String(rate),
    );
  }
});

test("invalid service IDs and quantity ranges are rejected", () => {
  for (const payload of [
    { service: "abc", name: "Service", rate: "1" },
    { service: "0", name: "Service", rate: "1" },
    { service: "1", name: "Service", rate: "1", min: "0" },
    { service: "1", name: "Service", rate: "1", min: "20", max: "10" },
    { service: "1", name: "Service", rate: "1", max: "Infinity" },
  ]) {
    assert.throws(() => normalizeSmmRajaServices([payload]), ProviderResponseInvalidError);
  }
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
    }, { listServices: async () => [] });
    await assert.rejects(
      adapter.listServices(catalogBusinessA),
      ProviderCatalogUnavailableError,
    );
  }
});
