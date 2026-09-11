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

test("Mercado Pago initial setup requires Public Key and Access Token and stays inactive", async () => {
  const local = vi.spyOn(Storage.prototype, "setItem"); const onSave = vi.fn(); const onClose = vi.fn();
  render(<IntegrationForm record="new" pending={false} error="" onClose={onClose} onSave={onSave} />);
  await userEvent.type(screen.getByLabelText("Public Key"), "mp-public-key");
  await userEvent.type(screen.getByLabelText("Access Token"), "mp-private-token");
  await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    providerKey: "mercado_pago", status: "inactive",
    credentials: { publicKey: "mp-public-key", accessToken: "mp-private-token" },
  }));
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

test("Mercado Pago edit shows its generated webhook URL and accepts complete activation credentials", async () => {
  const onSave = vi.fn();
  render(<IntegrationForm record={{
    id: "60878fd4-9a90-4f74-8905-d736c8b6ea11", businessId: "0e2f6f5e-72e1-4ec9-8680-0c2185d91c68",
    providerKey: "mercado_pago", status: "inactive", config: {},
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  }} pending={false} error="" onClose={vi.fn()} onSave={onSave} />);
  const webhookUrl = screen.getByDisplayValue(
    "http://localhost:3000/api/webhooks/mercado-pago/60878fd4-9a90-4f74-8905-d736c8b6ea11",
  ) as HTMLInputElement;
  expect(webhookUrl.readOnly).toBe(true);
  await userEvent.selectOptions(screen.getByLabelText("Estado"), "active");
  await userEvent.type(screen.getByLabelText("Reingresar Public Key (solo al actualizar credenciales)"), "mp-public-key");
  await userEvent.type(screen.getByLabelText("Reingresar Access Token (solo al actualizar credenciales)"), "mp-private-token");
  await userEvent.type(document.querySelector<HTMLInputElement>('input[name="webhookSecret"]')!, "mp-webhook-secret");
  await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    status: "active",
    credentials: { publicKey: "mp-public-key", accessToken: "mp-private-token", webhookSecret: "mp-webhook-secret" },
  }));
});

test("generic provider name remains editable after its first character",async()=>{
  render(<IntegrationForm record="new" pending={false} error="" onClose={vi.fn()} onSave={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText("Proveedor"),"generic");
  await userEvent.type(screen.getByLabelText("provider_key"),"custom_provider");
  expect(screen.getByLabelText("provider_key")).toHaveValue("custom_provider");
});

test("Telegram credentials are separate from public configuration",async()=>{
  const onSave=vi.fn();
  render(<IntegrationForm record="new" pending={false} error="" onClose={vi.fn()} onSave={onSave} />);
  await userEvent.selectOptions(screen.getByLabelText("Proveedor"),"telegram");
  await userEvent.type(screen.getByLabelText("Bot Token de Telegram"),"123:test-only");
  await userEvent.type(screen.getByLabelText("Webhook Secret de Telegram"),"t".repeat(32));
  await userEvent.click(screen.getByRole("button",{name:"Guardar"}));
  expect(onSave).toHaveBeenCalledWith({providerKey:"telegram",config:{},credentials:{botToken:"123:test-only",webhookSecret:"t".repeat(32)}});
});

test("automation runner uses its own write-only credential",async()=>{
  const onSave=vi.fn();
  render(<IntegrationForm record="new" pending={false} error="" onClose={vi.fn()} onSave={onSave} />);
  await userEvent.selectOptions(screen.getByLabelText("Proveedor"),"automation_runner");
  await userEvent.type(screen.getByLabelText("Runner Secret (32 caracteres o más)"),"r".repeat(32));
  await userEvent.click(screen.getByRole("button",{name:"Guardar"}));
  expect(onSave).toHaveBeenCalledWith({providerKey:"automation_runner",config:{},credentials:{runnerSecret:"r".repeat(32)}});
});
