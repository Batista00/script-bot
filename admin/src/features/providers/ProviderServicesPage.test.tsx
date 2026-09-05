import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "../../components/ui";
import { categoriesApi, integrationsApi, providerApi } from "../../lib/api/resources";
import type { ImportProviderProductInput, ProviderService } from "../../lib/api/types";
import { BusinessProvider } from "../businesses/business-context";
import {
  ProviderServicesPage,
  commercialInputsFromProvider,
  providerImportPayload,
  providerImportValidationMessage,
  providerOperationalFacts,
} from "./ProviderServicesPage";

const providerServiceId = "0112b819-6653-4234-821a-6a2fce393c3f";
const businessId = "30292e18-abfd-43c1-946d-8e18489a39a5";
const providerService: ProviderService = {
  id: providerServiceId, businessId,
  integrationId: "499aa88d-a044-4a60-b0c0-e463acfe4ac2",
  providerKey: "smm_raja", externalServiceId: "123", name: "Proveedor seguidores",
  category: "Instagram", serviceType: "Default", rate: "0.15", rateCurrency: null,
  minQuantity: 100, maxQuantity: 10_000, providerStatus: "active",
  providerDescription: "Descripción del proveedor", mappingCount: 0,
  orderCapabilities: {
    supported: true,
    required: [{ key: "targetUrl", providerField: "link", type: "url" }],
    optional: [], source: "official",
  },
  metadata: { description: "Descripción del proveedor" },
  lastSyncedAt: "2026-08-20T12:00:00.000Z", createdAt: "2026-08-20T12:00:00.000Z",
  updatedAt: "2026-08-20T12:00:00.000Z",
};

function formData(): FormData {
  const data = new FormData();
  data.set("name", "  Producto retail  "); data.set("description", "");
  data.set("categoryId", ""); data.set("sku", " RETAIL-1 "); data.set("type", "service");
  data.set("minQuantity", "100"); data.set("maxQuantity", ""); data.set("currency", "clp");
  data.set("pricingType", "unit"); data.set("retailPrice", "25"); data.set("status", "active");
  return data;
}

test("builds the editable atomic import payload", () => {
  expect(providerImportPayload(providerServiceId, formData())).toEqual({
    providerServiceId, name: "Producto retail", description: null, categoryId: null,
    sku: "RETAIL-1", type: "service", minQuantity: 100, maxQuantity: null,
    currency: "CLP", pricingType: "unit", retailPrice: 25, status: "active",
  });
});

test("translates provider capabilities into editable commercial fields", () => {
  expect(commercialInputsFromProvider([
    { key: "targetUrl", providerField: "link", type: "url" },
    { key: "comments", providerField: "comments", type: "textarea" },
  ])).toEqual([
    expect.objectContaining({ key: "targetUrl", label: "Enlace de destino", position: 0 }),
    expect.objectContaining({ key: "comments", label: "Comentarios", position: 1 }),
  ]);
});

test("presents operational provider metadata without turning it into retail data", () => {
  expect(providerOperationalFacts({
    ...providerService,
    metadata: { refill: true, cancel: false, extra_parameter: { start_time: "~6m", speed: "5-6k/day", reliability: "Medium" } },
  })).toEqual([
    { label: "Inicio estimado", value: "~6m" },
    { label: "Velocidad", value: "5-6k/day" },
    { label: "Fiabilidad", value: "Medium" },
    { label: "Reposición", value: "Sí" },
    { label: "Cancelación", value: "No" },
  ]);
});

test("explains invalid currency, price, and quantity instead of submitting a generic error", () => {
  const valid = providerImportPayload(providerServiceId, formData());
  expect(providerImportValidationMessage({ ...valid, currency: "" })).toMatch(/moneda retail/i);
  expect(providerImportValidationMessage({ ...valid, retailPrice: 0 })).toMatch(/precio retail/i);
  expect(providerImportValidationMessage({
    ...valid, minQuantity: 100, maxQuantity: 99,
  })).toMatch(/cantidad máxima/i);
  expect(providerImportValidationMessage(valid)).toBeNull();
});

test("calls the atomic provider import endpoint", async () => {
  const payload = providerImportPayload(providerServiceId, formData());
  const response = { product: { id: "p" }, price: { id: "r" }, mapping: { id: "m" } };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
    JSON.stringify(response),
    { status: 201, headers: { "content-type": "application/json" } },
  ));
  await expect(providerApi.importProduct(businessId, payload)).resolves.toEqual(response);
  expect(fetchMock).toHaveBeenCalledWith(
    `/api/businesses/${businessId}/provider-services/import-product`,
    expect.objectContaining({ method: "POST", credentials: "same-origin",
      body: JSON.stringify(payload satisfies ImportProviderProductInput) }),
  );
});

test("successful import invalidates every affected Business view", async () => {
  vi.spyOn(integrationsApi, "list").mockResolvedValue([]);
  vi.spyOn(categoriesApi, "list").mockResolvedValue([]);
  const listCall = vi.spyOn(providerApi, "list").mockResolvedValue([providerService]);
  const importCall = vi.spyOn(providerApi, "importProduct").mockResolvedValue({} as never);
  const client = new QueryClient({ defaultOptions: {
    queries: { retry: false }, mutations: { retry: false },
  } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}><ToastProvider>
      <BusinessProvider business={{ id: businessId, name: "Flowchat DEV", currency: "CLP", status: "active", role: "owner" }}>
        <ProviderServicesPage />
      </BusinessProvider>
    </ToastProvider></QueryClientProvider>,
  );

  await userEvent.type(screen.getByLabelText("Buscar por ID de servicio"), "123");
  await waitFor(() => expect(listCall).toHaveBeenCalledWith(
    businessId,
    expect.objectContaining({ externalServiceId: "123" }),
  ));
  await userEvent.click(await screen.findByRole("button", { name: "Importar" }));
  await userEvent.type(screen.getByLabelText(/Precio retail/), "25");
  await userEvent.click(screen.getAllByRole("button", { name: "Importar" }).at(-1)!);

  await waitFor(() => expect(importCall).toHaveBeenCalledWith(
    businessId,
    expect.objectContaining({ providerServiceId, retailPrice: 25, currency: "CLP" }),
  ));
  await waitFor(() => {
    for (const resource of ["products", "pricing", "mapping", "provider-services"]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [resource, businessId] });
    }
  });
});
