import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { businessQueryKey } from "../../app/query-client";
import { Button, EmptyState, Field, Modal, PageHeader, SelectField, Spinner, StatusBadge, useToast } from "../../components/ui";
import { errorMessage } from "../../lib/api/client";
import { membershipsApi } from "../../lib/api/resources";
import type { CreateMembershipInput, Membership, Role, UpdateMembershipInput } from "../../lib/api/types";
import { useAuth } from "../auth/auth-context";
import { useBusiness } from "../businesses/business-context";

const roleLabels: Record<Role, string> = { owner: "Owner", admin: "Admin", operator: "Operador" };

/** An admin can never grant owner; only an owner keeps that privilege. */
export function assignableRoles(actorRole: Role): Role[] {
  return actorRole === "owner" ? ["owner", "admin", "operator"] : ["admin", "operator"];
}

/** Builds the invitation payload: name/password only travel for new accounts. */
export function membershipPayload(email: string, role: Role, name: string, password: string): CreateMembershipInput {
  const payload: CreateMembershipInput = { email: email.trim().toLowerCase(), role };
  if (name.trim() !== "") payload.name = name.trim();
  if (password.trim() !== "") payload.password = password.trim();
  return payload;
}

/**
 * Mirrors the backend rules before the request: an admin never manages its own
 * access, an admin never manages owners, and the last active owner is never
 * degraded. An owner with a co-owner may still step down from this screen.
 */
export function membershipGuard(
  actorRole: Role, actorUserId: string | undefined, target: Membership, activeOwners: number,
): string | null {
  if (target.userId === actorUserId && actorRole !== "owner") return "No puedes modificar tu propia membresía.";
  if (target.role === "owner" && actorRole !== "owner") return "Solo un owner puede gestionar a otro owner.";
  if (target.role === "owner" && target.status === "active" && activeOwners <= 1) return "El negocio debe conservar al menos un owner activo.";
  return null;
}

export function TeamPage() {
  const business = useBusiness(); const { auth } = useAuth(); const client = useQueryClient(); const toast = useToast();
  const [creating, setCreating] = useState(false); const [formError, setFormError] = useState<string | null>(null);
  const canManage = business.role === "owner" || business.role === "admin";
  const query = useQuery({ queryKey: businessQueryKey("memberships", business.id), queryFn: () => membershipsApi.list(business.id), enabled: canManage });
  const invalidate = async () => { await client.invalidateQueries({ queryKey: ["memberships", business.id] }); };
  const update = useMutation({ mutationFn: ({ item, body }: { item: Membership; body: UpdateMembershipInput }) => membershipsApi.update(business.id, item.id, body), onSuccess: async () => { await invalidate(); toast("Membresía actualizada."); } });
  const remove = useMutation({ mutationFn: (item: Membership) => membershipsApi.remove(business.id, item.id), onSuccess: async () => { await invalidate(); toast("Membresía retirada."); } });
  const create = useMutation({ mutationFn: (body: CreateMembershipInput) => membershipsApi.create(business.id, body), onSuccess: async () => { setCreating(false); await invalidate(); toast("Miembro invitado."); } });
  const members = query.data ?? [];
  const activeOwners = members.filter((item) => item.role === "owner" && item.status === "active").length;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget); const name = String(data.get("name") ?? ""); const password = String(data.get("password") ?? "");
    if (name.trim() !== "" && password.trim() === "") { setFormError("Indica también la contraseña para crear la cuenta nueva."); return; }
    if (password.trim() !== "" && name.trim() === "") { setFormError("Indica también el nombre para crear la cuenta nueva."); return; }
    if (password.trim() !== "" && (password.length < 12 || password.length > 128)) { setFormError("La contraseña debe tener entre 12 y 128 caracteres."); return; }
    setFormError(null);
    create.mutate(membershipPayload(String(data.get("email") ?? ""), String(data.get("role")) as Role, name, password));
  }
  function changeRole(item: Membership, role: Role) {
    if (role === "owner" && !window.confirm("¿Conceder el rol owner a este miembro?")) return;
    update.mutate({ item, body: { role } });
  }
  function toggleStatus(item: Membership) {
    const status = item.status === "active" ? "inactive" : "active";
    if (status === "inactive" && !window.confirm("¿Desactivar el acceso de este miembro?")) return;
    update.mutate({ item, body: { status } });
  }
  function withdraw(item: Membership) {
    if (!window.confirm("¿Retirar a este miembro del negocio?")) return;
    remove.mutate(item);
  }
  return <>
    <PageHeader title="Equipo" description="Miembros del negocio, sus roles y el estado de su acceso." action={canManage ? <Button onClick={() => { setFormError(null); setCreating(true); }}>Invitar miembro</Button> : undefined} />
    {!canManage && <div className="alert">Necesitas rol owner o admin para ver y gestionar el equipo.</div>}
    {(update.isError || remove.isError) && <div className="alert error">{errorMessage(update.error ?? remove.error)}</div>}
    {canManage && (query.isLoading ? <Spinner /> : query.isError ? <div className="alert error">{errorMessage(query.error)}</div> : !members.length ? <EmptyState title="No hay miembros registrados." /> : <div className="table-card"><div className="table-scroll"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Membresía</th><th>Cuenta</th><th>Acciones</th></tr></thead><tbody>{members.map((item) => {
      const guard = membershipGuard(business.role, auth?.user.id, item, activeOwners);
      const self = item.userId === auth?.user.id;
      return <tr key={item.id}><td>{item.user.name}{self && " (tú)"}</td><td>{item.user.email}</td><td>{guard ? roleLabels[item.role] : <select aria-label={`Rol de ${item.user.name || item.user.email}`} value={item.role} disabled={update.isPending} onChange={(event) => changeRole(item, event.target.value as Role)}>{assignableRoles(business.role).map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select>}</td><td><StatusBadge value={item.status} /></td><td><StatusBadge value={item.user.status} /></td><td><div className="form-actions">{guard ? <small>{guard}</small> : <><Button className="secondary small" disabled={update.isPending} onClick={() => toggleStatus(item)}>{item.status === "active" ? "Desactivar acceso" : "Activar acceso"}</Button><Button className="danger small" disabled={remove.isPending} onClick={() => withdraw(item)}>Retirar</Button></>}</div></td></tr>;
    })}</tbody></table></div></div>)}
    {creating && <Modal title="Invitar miembro" onClose={() => setCreating(false)}><form onSubmit={submit}><Field label="Correo" name="email" type="email" required maxLength={254} /><SelectField label="Rol" name="role" defaultValue="operator" required>{assignableRoles(business.role).map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</SelectField><Field label="Nombre (cuenta nueva)" name="name" maxLength={120} hint="Obligatorio si el correo todavía no tiene cuenta." /><Field label="Contraseña (cuenta nueva)" name="password" type="password" maxLength={128} hint="Entre 12 y 128 caracteres. Obligatoria si el correo todavía no tiene cuenta." />{formError && <div className="alert error">{formError}</div>}{create.isError && <div className="alert error">{errorMessage(create.error)}</div>}<div className="form-actions"><Button className="secondary" type="button" onClick={() => setCreating(false)}>Cancelar</Button><Button type="submit" disabled={create.isPending}>Invitar</Button></div></form></Modal>}
  </>;
}
