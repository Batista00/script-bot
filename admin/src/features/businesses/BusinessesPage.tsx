import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Button, Field, Modal, PageHeader, SelectField, Spinner, StatusBadge, useToast } from "../../components/ui";
import { authApi, businessesApi } from "../../lib/api/resources";
import type { Business } from "../../lib/api/types";
import { authQueryKey, useAuth } from "../auth/auth-context";

export function BusinessesPage() {
  const { auth, setAuth } = useAuth();
  const [editing, setEditing] = useState<Business | "new" | null>(null);
  const client = useQueryClient(); const navigate = useNavigate(); const toast = useToast();
  const query = useQuery({ queryKey: ["businesses"], queryFn: businessesApi.list });
  const mutation = useMutation({ mutationFn: async (data: { name: string; status?: "active" | "inactive" }) => {
    if (editing === "new") return businessesApi.create({ name: data.name });
    if (!editing) throw new Error("No business selected");
    return businessesApi.update(editing.id, data);
  }, onSuccess: async () => {
    await client.invalidateQueries({ queryKey: ["businesses"] });
    const view = await authApi.me(); client.setQueryData(authQueryKey, view); setAuth(view);
    setEditing(null); toast("Negocio guardado.");
  }});
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const status = data.get("status");
    if (status === "inactive" && !window.confirm("¿Desactivar este negocio?")) return;
    mutation.mutate({ name: String(data.get("name")), ...(status ? { status: status as "active" | "inactive" } : {}) });
  }
  return <main className="standalone-page">
    <header className="standalone-top"><div className="sidebar-brand"><span className="brand-mark">BW</span><strong>BOT WHATSAP</strong></div><div><span className="muted">{auth?.user.name}</span> <Button className="secondary" onClick={async () => { await authApi.logout(); setAuth(null); navigate("/login", { replace: true }); }}>Cerrar sesión</Button></div></header>
    <div className="page"><PageHeader title="Negocios" description="Selecciona el contexto de trabajo o crea un cliente nuevo." action={<Button onClick={() => setEditing("new")}>Crear negocio</Button>} />
      {query.isLoading ? <Spinner /> : <div className="business-grid">{query.data?.map((business) => {
        const access = auth?.businesses.find((item) => item.id === business.id);
        return <article className="business-card" key={business.id}><div><span className="eyebrow">{access?.role ?? "miembro"}</span><h2>{business.name}</h2><StatusBadge value={business.status} /></div><div className="actions"><Button onClick={() => navigate(`/businesses/${business.id}/dashboard`)}>Abrir</Button>{access && access.role !== "operator" && <Button className="secondary" onClick={() => setEditing(business)}>Editar</Button>}</div></article>;
      })}</div>}
      {editing && <Modal title={editing === "new" ? "Crear negocio" : "Editar negocio"} onClose={() => setEditing(null)}><form onSubmit={submit}><Field label="Nombre" name="name" defaultValue={editing === "new" ? "" : editing.name} required maxLength={120} />{editing !== "new" && <SelectField label="Estado" name="status" defaultValue={editing.status}><option value="active">Activo</option><option value="inactive">Inactivo</option></SelectField>}<div className="form-actions"><Button className="secondary" type="button" onClick={() => setEditing(null)}>Cancelar</Button><Button type="submit" disabled={mutation.isPending}>Guardar</Button></div></form></Modal>}
    </div>
  </main>;
}
