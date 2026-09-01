import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntegrationForm } from "./IntegrationsPage";

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
