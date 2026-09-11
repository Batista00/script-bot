import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "../../components/ui";
import { membershipsApi } from "../../lib/api/resources";
import type { AuthView, Membership, Role, Status } from "../../lib/api/types";
import { AuthProvider, authQueryKey } from "../auth/auth-context";
import { BusinessProvider } from "../businesses/business-context";
import { TeamPage } from "./TeamPage";

const businessId = "30292e18-abfd-43c1-946d-8e18489a39a5";
const now = "2026-01-01T00:00:00.000Z";

function member(id: string, name: string, role: Role, status: Status = "active", userStatus: Status = "active"): Membership {
  return {
    id, businessId, userId: `user-${id}`, role, status, createdAt: now, updatedAt: now,
    user: { id: `user-${id}`, email: `${name.toLowerCase()}@example.com`, name, status: userStatus },
  };
}

function authFor(userId: string, role: Role): AuthView {
  return {
    user: { id: userId, email: "actor@example.com", name: "Actor", status: "active", createdAt: now, updatedAt: now },
    businesses: [{ id: businessId, name: "Flowchat DEV", currency: "CLP", status: "active", role }],
  };
}

function renderTeam(role: Role, actorId: string, members: Membership[]) {
  const list = vi.spyOn(membershipsApi, "list").mockResolvedValue(members);
  const create = vi.spyOn(membershipsApi, "create").mockResolvedValue(members[0]!);
  const update = vi.spyOn(membershipsApi, "update").mockResolvedValue(members[0]!);
  const remove = vi.spyOn(membershipsApi, "remove").mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(authQueryKey, authFor(actorId, role));
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}><ToastProvider><AuthProvider>
      <BusinessProvider business={{ id: businessId, name: "Flowchat DEV", currency: "CLP", status: "active", role }}>
        <TeamPage />
      </BusinessProvider>
    </AuthProvider></ToastProvider></QueryClientProvider>,
  );
  return { list, create, update, remove, invalidate };
}

const ana = member("ana", "Ana", "owner");
const beto = member("beto", "Beto", "admin");
const carla = member("carla", "Carla", "operator");
const diego = member("diego", "Diego", "operator", "inactive", "inactive");

test("lists members with their role, membership status and account status", async () => {
  const { list } = renderTeam("owner", "user-ana", [ana, beto, carla, diego]);
  expect(await screen.findByText("Beto")).toBeInTheDocument();
  expect(screen.getByText("beto@example.com")).toBeInTheDocument();
  expect(list).toHaveBeenCalledWith(businessId);

  const carlaRow = screen.getByText("Carla").closest("tr")!;
  expect(within(carlaRow).getByText("Operador")).toBeInTheDocument();
  const diegoRow = screen.getByText("Diego").closest("tr")!;
  expect(within(diegoRow).getAllByText("inactive")).toHaveLength(2);
});

test("operator cannot see team administration and never queries the endpoint", async () => {
  const { list } = renderTeam("operator", "user-carla", [ana]);
  expect(await screen.findByText(/Necesitas rol owner o admin/)).toBeInTheDocument();
  expect(list).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Invitar miembro" })).not.toBeInTheDocument();
});

test("admin cannot manage owners, cannot edit itself and cannot grant owner", async () => {
  renderTeam("admin", "user-beto", [ana, beto, carla]);
  await screen.findByText("Carla");

  const ownerRow = screen.getByText("Ana").closest("tr")!;
  expect(within(ownerRow).getByText("Solo un owner puede gestionar a otro owner.")).toBeInTheDocument();
  expect(within(ownerRow).queryByRole("button", { name: "Retirar" })).not.toBeInTheDocument();

  const selfRow = screen.getByText("Beto (tú)").closest("tr")!;
  expect(within(selfRow).getByText("No puedes modificar tu propia membresía.")).toBeInTheDocument();
  expect(within(selfRow).queryByRole("button", { name: "Retirar" })).not.toBeInTheDocument();

  const select = within(screen.getByText("Carla").closest("tr")!).getByLabelText("Rol de Carla");
  expect(within(select).queryByRole("option", { name: "Owner" })).not.toBeInTheDocument();
  expect(within(select).getByRole("option", { name: "Admin" })).toBeInTheDocument();
});

test("owner invites an existing account without a password", async () => {
  const { create } = renderTeam("owner", "user-ana", [ana]);
  await userEvent.click(await screen.findByRole("button", { name: "Invitar miembro" }));
  await userEvent.type(screen.getByLabelText("Correo"), "nuevo@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Invitar" }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(businessId, { email: "nuevo@example.com", role: "operator" }));
});

test("owner creates a new account with name and password", async () => {
  const { create } = renderTeam("owner", "user-ana", [ana]);
  await userEvent.click(await screen.findByRole("button", { name: "Invitar miembro" }));
  await userEvent.type(screen.getByLabelText("Correo"), "Nueva@Example.com");
  await userEvent.selectOptions(screen.getByLabelText("Rol"), "admin");
  await userEvent.type(screen.getByLabelText(/Nombre \(cuenta nueva\)/), "Nueva Persona");
  await userEvent.type(screen.getByLabelText(/Contraseña \(cuenta nueva\)/), "clave-segura-123");
  await userEvent.click(screen.getByRole("button", { name: "Invitar" }));
  await waitFor(() => expect(create).toHaveBeenCalledWith(businessId, {
    email: "nueva@example.com", role: "admin", name: "Nueva Persona", password: "clave-segura-123",
  }));
});

test("owner is warned before sending an incomplete new account", async () => {
  const { create } = renderTeam("owner", "user-ana", [ana]);
  await userEvent.click(await screen.findByRole("button", { name: "Invitar miembro" }));
  await userEvent.type(screen.getByLabelText("Correo"), "nuevo@example.com");
  await userEvent.type(screen.getByLabelText(/Nombre \(cuenta nueva\)/), "Solo nombre");
  await userEvent.click(screen.getByRole("button", { name: "Invitar" }));
  expect(await screen.findByText(/Indica también la contraseña/)).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
});

test("owner changes roles, toggles access, withdraws memberships and invalidates the list", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const { update, remove, invalidate } = renderTeam("owner", "user-ana", [ana, beto, carla, diego]);
  await screen.findByText("Carla");

  await userEvent.selectOptions(screen.getByLabelText("Rol de Beto"), "operator");
  await waitFor(() => expect(update).toHaveBeenCalledWith(businessId, beto.id, { role: "operator" }));

  await userEvent.click(within(screen.getByText("Carla").closest("tr")!).getByRole("button", { name: "Desactivar acceso" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(businessId, carla.id, { status: "inactive" }));

  await userEvent.click(within(screen.getByText("Diego").closest("tr")!).getByRole("button", { name: "Activar acceso" }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(businessId, diego.id, { status: "active" }));

  await userEvent.click(within(screen.getByText("Beto").closest("tr")!).getByRole("button", { name: "Retirar" }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(businessId, beto.id));

  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["memberships", businessId] }));
});

test("granting the owner role requires confirmation", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  const { update } = renderTeam("owner", "user-ana", [ana, carla]);
  await screen.findByText("Carla");
  await userEvent.selectOptions(screen.getByLabelText("Rol de Carla"), "owner");
  expect(window.confirm).toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

test("the last active owner cannot degrade its own access", async () => {
  renderTeam("owner", "user-ana", [ana, carla]);
  await screen.findByText("Carla");
  const selfRow = screen.getByText("Ana (tú)").closest("tr")!;
  expect(within(selfRow).getByText("El negocio debe conservar al menos un owner activo.")).toBeInTheDocument();
  expect(within(selfRow).queryByRole("button", { name: "Retirar" })).not.toBeInTheDocument();
});

test("an owner with a co-owner can manage its own membership", async () => {
  const second = member("otro", "Otro", "owner");
  const { update } = renderTeam("owner", "user-ana", [ana, second]);
  await screen.findByText("Otro");

  const selfRow = screen.getByText("Ana (tú)").closest("tr")!;
  await userEvent.selectOptions(within(selfRow).getByLabelText("Rol de Ana"), "admin");
  await waitFor(() => expect(update).toHaveBeenCalledWith(businessId, ana.id, { role: "admin" }));
});

