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
