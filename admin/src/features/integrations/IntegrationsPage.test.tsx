import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntegrationForm } from "./IntegrationsPage";

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
