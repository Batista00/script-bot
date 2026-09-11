import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "../../components/ui";
import { ApiError } from "../../lib/api/client";
import { integrationsApi, paymentsApi } from "../../lib/api/resources";
import type { Integration } from "../../lib/api/types";
import { BusinessProvider } from "../businesses/business-context";
import { IntegrationForm, IntegrationsPage } from "./IntegrationsPage";

const businessId = "30292e18-abfd-43c1-946d-8e18489a39a5";
const mercadoPagoIntegration: Integration = {
  id: "499aa88d-a044-4a60-b0c0-e463acfe4ac2", businessId, providerKey: "mercado_pago",
  status: "active", config: {}, createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderIntegrations(role: "owner" | "operator" = "owner") {
  const client = new QueryClient({ defaultOptions: {
    queries: { retry: false }, mutations: { retry: false },
  } });
  render(
    <QueryClientProvider client={client}><ToastProvider>
      <BusinessProvider business={{ id: businessId, name: "Flowchat DEV", currency: "CLP", status: "active", role }}>
        <IntegrationsPage />
      </BusinessProvider>
    </ToastProvider></QueryClientProvider>,
  );
}

test("integration secrets are submitted write-only and never persisted in browser storage", async () => {
  const local = vi.spyOn(Storage.prototype, "setItem"); const onSave = vi.fn(); const onClose = vi.fn();
  render(<IntegrationForm record="new" pending={false} error="" onClose={onClose} onSave={onSave} />);
  await userEvent.type(screen.getByLabelText("Access Token"), "mp-private-token");
  await userEvent.type(screen.getByLabelText("Webhook Secret"), "mp-webhook-secret");
  await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ credentials: { accessToken: "mp-private-token", webhookSecret: "mp-webhook-secret" } }));
  expect(local).not.toHaveBeenCalled(); expect(localStorage.getItem("mp-private-token")).toBeNull(); expect(sessionStorage.getItem("mp-private-token")).toBeNull();
  expect(window.location.href).not.toContain("mp-private-token");
});

test("probes the Mercado Pago connection and reports ok", async () => {
  vi.spyOn(integrationsApi, "list").mockResolvedValue([mercadoPagoIntegration]);
  const testCall = vi.spyOn(paymentsApi, "testConnection").mockResolvedValue({
    integrationId: mercadoPagoIntegration.id, providerKey: "mercado_pago",
    connectionStatus: "ok", checkedAt: "2026-09-01T12:00:00.000Z",
  });
  renderIntegrations();

  await userEvent.click(await screen.findByRole("button", { name: "Probar conexión" }));

  await waitFor(() => expect(testCall).toHaveBeenCalledWith(businessId, mercadoPagoIntegration.id));
  expect(await screen.findByText(/Conexión OK/)).toBeInTheDocument();
});

test("surfaces rejected Mercado Pago credentials with the translated message", async () => {
  vi.spyOn(integrationsApi, "list").mockResolvedValue([mercadoPagoIntegration]);
  vi.spyOn(paymentsApi, "testConnection").mockRejectedValue(new ApiError(
    409, "PAYMENT_PROVIDER_CREDENTIALS_INVALID",
    "Mercado Pago rechazó las credenciales guardadas. Actualiza el access token desde Integraciones y vuelve a probar.",
  ));
  renderIntegrations();

  await userEvent.click(await screen.findByRole("button", { name: "Probar conexión" }));

  expect(await screen.findByText(/Mercado Pago rechazó las credenciales guardadas/)).toBeInTheDocument();
});

test("operators can still probe the connection but cannot edit integrations", async () => {
  vi.spyOn(integrationsApi, "list").mockResolvedValue([mercadoPagoIntegration]);
  vi.spyOn(paymentsApi, "testConnection").mockResolvedValue({
    integrationId: mercadoPagoIntegration.id, providerKey: "mercado_pago",
    connectionStatus: "ok", checkedAt: "2026-09-01T12:00:00.000Z",
  });
  renderIntegrations("operator");

  expect(await screen.findByRole("button", { name: "Probar conexión" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
});
