import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button, Field, PageHeader, SelectField, useToast } from "../../components/ui";
import { errorMessage } from "../../lib/api/client";
import { authApi, businessesApi } from "../../lib/api/resources";
import { authQueryKey, useAuth } from "../auth/auth-context";
import { useBusiness } from "./business-context";

export function BusinessSettingsPage() {
  const business = useBusiness(); const { setAuth } = useAuth(); const client = useQueryClient(); const toast = useToast(); const [saved, setSaved] = useState(false);
  const mutation = useMutation({ mutationFn: (body: { name: string; status: "active" | "inactive" }) => businessesApi.update(business.id, body), onSuccess: async () => { const view = await authApi.me(); client.setQueryData(authQueryKey, view); setAuth(view); setSaved(true); toast("Configuración actualizada."); } });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const body = { name: String(data.get("name")), status: String(data.get("status")) as "active" | "inactive" }; if (body.status === "inactive" && !window.confirm("¿Desactivar el negocio actual?")) return; setSaved(false); mutation.mutate(body); }
  return <><PageHeader title="Configuración" description="Solo campos soportados actualmente por Business Core." />{business.role === "operator" ? <div className="alert">Necesitas rol owner o admin para editar el negocio.</div> : <section className="form-card"><form onSubmit={submit}><Field label="Nombre" name="name" defaultValue={business.name} required maxLength={120} /><SelectField label="Estado" name="status" defaultValue={business.status}><option value="active">Activo</option><option value="inactive">Inactivo</option></SelectField>{mutation.isError && <div className="alert error">{errorMessage(mutation.error)}</div>}{saved && <div className="alert success">Cambios guardados.</div>}<Button type="submit" disabled={mutation.isPending}>Guardar configuración</Button></form></section>}</>;
}
