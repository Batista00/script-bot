import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { businessQueryKey } from "../../app/query-client";
import { Button, EmptyState, Field, Modal, PageHeader, Pagination, SelectField, Spinner, StatusBadge, TextAreaField, useToast } from "../../components/ui";
import { errorMessage } from "../../lib/api/client";
import { integrationsApi } from "../../lib/api/resources";
import type { Integration } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";

function nonEmpty(data: FormData, name: string): string | undefined { const value = String(data.get(name) ?? "").trim(); return value || undefined; }
export function integrationPayload(form: HTMLFormElement, providerKey: string, creating: boolean): Record<string, unknown> {
  const data = new FormData(form); let config: Record<string, unknown> = {}; let credentials: Record<string, unknown> | undefined;
  if (providerKey === "mercado_pago") {
    config = Object.fromEntries(["successUrl", "pendingUrl", "failureUrl"].flatMap((key) => { const value = nonEmpty(data, key); return value ? [[key, value]] : []; }));
    const accessToken = nonEmpty(data, "accessToken"); const webhookSecret = nonEmpty(data, "webhookSecret");
    if (accessToken || webhookSecret) credentials = { ...(accessToken ? { accessToken } : {}), ...(webhookSecret ? { webhookSecret } : {}) };
  } else if (providerKey === "smm_raja") {
    const apiKey = nonEmpty(data, "apiKey"); if (apiKey) credentials = { apiKey };
  } else {
    const configText = nonEmpty(data, "configJson"); const credentialsText = nonEmpty(data, "credentialsJson");
    if (configText) config = JSON.parse(configText) as Record<string, unknown>;
    if (credentialsText) credentials = JSON.parse(credentialsText) as Record<string, unknown>;
  }
  if (creating && !credentials) throw new Error("Ingresa las credenciales requeridas.");
  return { ...(creating ? { providerKey } : {}), config, ...(credentials ? { credentials } : {}), ...(!creating ? { status: String(data.get("status")) } : {}) };
}

export function IntegrationsPage() {
  const business = useBusiness(); const client = useQueryClient(); const toast = useToast(); const [offset, setOffset] = useState(0); const [editing, setEditing] = useState<Integration | "new" | null>(null);
  const query = useQuery({ queryKey: businessQueryKey("integrations", business.id, { offset }), queryFn: () => integrationsApi.list(business.id, { limit: 25, offset }) });
  const mutation = useMutation({ mutationFn: ({ record, body }: { record: Integration | "new"; body: unknown }) => record === "new" ? integrationsApi.create(business.id, body) : integrationsApi.update(business.id, record.id, body), onSuccess: async () => { setEditing(null); await client.invalidateQueries({ queryKey: ["integrations", business.id] }); toast("Integración guardada. Las credenciales no se volverán a mostrar."); } });
  return <><PageHeader title="Integraciones" description="Configuración pública y credenciales write-only cifradas por el backend." action={business.role !== "operator" ? <Button onClick={() => setEditing("new")}>Configurar integración</Button> : undefined} />
    {business.role === "operator" && <div className="alert">Las integraciones requieren rol owner o admin.</div>}{query.isLoading ? <Spinner /> : query.isError ? <div className="alert error">{errorMessage(query.error)}</div> : !query.data?.length ? <EmptyState title="No hay integraciones configuradas." /> : <div className="table-card"><div className="table-scroll"><table><thead><tr><th>Proveedor</th><th>Estado</th><th>Configuración pública</th><th>Credenciales</th><th /></tr></thead><tbody>{query.data.map((item) => <tr key={item.id}><td>{item.providerKey}</td><td><StatusBadge value={item.status} /></td><td><code>{JSON.stringify(item.config)}</code></td><td>Configurado · ********</td><td>{business.role !== "operator" && <Button className="secondary small" onClick={() => setEditing(item)}>Editar</Button>}</td></tr>)}</tbody></table></div><Pagination offset={offset} limit={25} count={query.data.length} onChange={setOffset} /></div>}
    {editing && <IntegrationForm record={editing} pending={mutation.isPending} error={mutation.isError ? errorMessage(mutation.error) : ""} onClose={() => setEditing(null)} onSave={(body) => mutation.mutate({ record: editing, body })} />}
  </>;
}

export function IntegrationForm({ record, pending, error, onClose, onSave }: { record: Integration | "new"; pending: boolean; error: string; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [providerKey, setProviderKey] = useState(record === "new" ? "mercado_pago" : record.providerKey); const [formError, setFormError] = useState(""); const creating = record === "new"; const config = creating ? {} : record.config;
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setFormError(""); const data = new FormData(event.currentTarget); if (!creating && data.get("status") === "inactive" && record.status === "active" && !window.confirm("¿Desactivar esta integración?")) return; try { onSave(integrationPayload(event.currentTarget, providerKey, creating)); } catch { setFormError("Revisa el JSON y las credenciales requeridas."); } }
  return <Modal title={creating ? "Configurar integración" : `Editar ${providerKey}`} onClose={onClose}><form onSubmit={submit} autoComplete="off">{creating ? <><SelectField label="Proveedor" value={["mercado_pago", "smm_raja", "generic"].includes(providerKey) ? providerKey : "generic"} onChange={(event) => setProviderKey(event.target.value === "generic" ? "" : event.target.value)}><option value="mercado_pago">Mercado Pago</option><option value="smm_raja">SMM Raja</option><option value="generic">Otro proveedor</option></SelectField>{providerKey === "" && <Field label="provider_key" value={providerKey} onChange={(event) => setProviderKey(event.target.value)} required pattern="[a-z0-9][a-z0-9_]*" />}</> : <SelectField label="Estado" name="status" defaultValue={record.status}><option value="active">Activo</option><option value="inactive">Inactivo</option></SelectField>}
      {providerKey === "mercado_pago" && <><Field label="Success URL (config)" name="successUrl" type="url" defaultValue={String(config.successUrl ?? "")} /><Field label="Pending URL (config)" name="pendingUrl" type="url" defaultValue={String(config.pendingUrl ?? "")} /><Field label="Failure URL (config)" name="failureUrl" type="url" defaultValue={String(config.failureUrl ?? "")} /><Field label={creating ? "Access Token" : "Nuevo Access Token (opcional)"} name="accessToken" type="password" autoComplete="new-password" required={creating} /><Field label={creating ? "Webhook Secret" : "Nuevo Webhook Secret (opcional)"} name="webhookSecret" type="password" autoComplete="new-password" required={creating} /></>}
      {providerKey === "smm_raja" && <Field label={creating ? "API key" : "Nueva API key (opcional)"} name="apiKey" type="password" autoComplete="new-password" required={creating} />}
      {providerKey !== "mercado_pago" && providerKey !== "smm_raja" && providerKey !== "" && <><TextAreaField label="Config JSON (sin secretos)" name="configJson" defaultValue={creating ? "{}" : JSON.stringify(config, null, 2)} /><TextAreaField label={creating ? "Credentials JSON" : "Nuevas credentials JSON (opcional)"} name="credentialsJson" required={creating} /></>}
      {!creating && <p className="muted">Credenciales actuales: configuradas · ********. Solo se reemplazan si completas un campo nuevo.</p>}{(formError || error) && <div className="alert error">{formError || error}</div>}<div className="form-actions"><Button className="secondary" type="button" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={pending || !providerKey}>Guardar</Button></div></form></Modal>;
}
