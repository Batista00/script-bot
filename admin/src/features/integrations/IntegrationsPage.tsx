import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { businessQueryKey } from "../../app/query-client";
import { Button, EmptyState, Field, Modal, PageHeader, Pagination, SelectField, Spinner, StatusBadge, TextAreaField, useToast } from "../../components/ui";
import { apiBasePath, errorMessage } from "../../lib/api/client";
import { integrationsApi, paymentsApi } from "../../lib/api/resources";
import type { Integration } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";

function nonEmpty(data: FormData, name: string): string | undefined { const value = String(data.get(name) ?? "").trim(); return value || undefined; }
const knownProviders = ["mercado_pago", "smm_raja", "telegram", "automation_runner"];
export function mercadoPagoWebhookUrl(integrationId: string): string {
  const apiBase = new URL(apiBasePath.endsWith("/") ? apiBasePath : `${apiBasePath}/`, window.location.origin);
  return new URL(`webhooks/mercado-pago/${integrationId}`, apiBase).toString();
}
export function integrationPayload(form: HTMLFormElement, providerKey: string, creating: boolean): Record<string, unknown> {
  const data = new FormData(form); let config: Record<string, unknown> = {}; let credentials: Record<string, unknown> | undefined;
  if (providerKey === "mercado_pago") {
    config = Object.fromEntries(["successUrl", "pendingUrl", "failureUrl"].flatMap((key) => { const value = nonEmpty(data, key); return value ? [[key, value]] : []; }));
    const configuredBackUrls = Object.keys(config).length;
    if (configuredBackUrls !== 0 && configuredBackUrls !== 3) throw new Error("Completa las tres URL de retorno o déjalas vacías.");
    const publicKey = nonEmpty(data, "publicKey"); const accessToken = nonEmpty(data, "accessToken"); const webhookSecret = nonEmpty(data, "webhookSecret");
    if (creating && (!publicKey || !accessToken)) throw new Error("Public Key y Access Token son obligatorios.");
    if (publicKey || accessToken || webhookSecret) {
      if (!creating && (!publicKey || !accessToken || !webhookSecret)) throw new Error("Para actualizar credenciales reingresa Public Key, Access Token y Webhook Secret.");
      credentials = { ...(publicKey ? { publicKey } : {}), ...(accessToken ? { accessToken } : {}), ...(webhookSecret ? { webhookSecret } : {}) };
    }
  } else if (providerKey === "smm_raja") {
    const apiKey = nonEmpty(data, "apiKey"); if (apiKey) credentials = { apiKey };
  } else if (providerKey === "telegram") {
    const botToken = nonEmpty(data, "botToken"); const webhookSecret = nonEmpty(data, "webhookSecret");
    if (botToken || webhookSecret) {
      if (!botToken || !webhookSecret || webhookSecret.length < 32) throw new Error("Completa ambos secretos de Telegram.");
      credentials = { botToken, webhookSecret };
    }
  } else if (providerKey === "automation_runner") {
    const runnerSecret = nonEmpty(data, "runnerSecret");
    if (runnerSecret) {
      if (runnerSecret.length < 32) throw new Error("El secreto requiere al menos 32 caracteres.");
      credentials = { runnerSecret };
    }
  } else {
    const configText = nonEmpty(data, "configJson"); const credentialsText = nonEmpty(data, "credentialsJson");
    if (configText) config = JSON.parse(configText) as Record<string, unknown>;
    if (credentialsText) credentials = JSON.parse(credentialsText) as Record<string, unknown>;
  }
  if (creating && !credentials) throw new Error("Ingresa las credenciales requeridas.");
  return { ...(creating ? { providerKey, ...(providerKey === "mercado_pago" ? { status: nonEmpty(data, "webhookSecret") ? "active" : "inactive" } : {}) } : {}), config, ...(credentials ? { credentials } : {}), ...(!creating ? { status: String(data.get("status")) } : {}) };
}

export function IntegrationsPage() {
  const business = useBusiness(); const client = useQueryClient(); const toast = useToast(); const [offset, setOffset] = useState(0); const [editing, setEditing] = useState<Integration | "new" | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const query = useQuery({ queryKey: businessQueryKey("integrations", business.id, { offset }), queryFn: () => integrationsApi.list(business.id, { limit: 25, offset }) });
  const mutation = useMutation({ mutationFn: ({ record, body }: { record: Integration | "new"; body: unknown }) => record === "new" ? integrationsApi.create(business.id, body) : integrationsApi.update(business.id, record.id, body), onSuccess: async (saved, variables) => { setEditing(variables.record === "new" && saved.providerKey === "mercado_pago" ? saved : null); await client.invalidateQueries({ queryKey: ["integrations", business.id] }); toast(saved.providerKey === "mercado_pago" && saved.status === "inactive" ? "Credenciales iniciales guardadas. Configura la URL del webhook y luego activa la integración." : "Integración guardada. Las credenciales no se volverán a mostrar."); } });
  const testConnection = useMutation({
    mutationFn: (integrationId: string) => paymentsApi.testConnection(business.id, integrationId),
    onSuccess: (result) => {
      setTestResults((previous) => ({ ...previous, [result.integrationId]: { ok: true, message: `Conexión OK · verificado el ${new Date(result.checkedAt).toLocaleString()}` } }));
      toast("Mercado Pago aceptó las credenciales guardadas.");
    },
    onError: (error, integrationId) => {
      setTestResults((previous) => ({ ...previous, [integrationId]: { ok: false, message: errorMessage(error) } }));
    },
  });
  return <><PageHeader title="Integraciones" description="Configuración pública y credenciales write-only cifradas por el backend." action={business.role !== "operator" ? <Button onClick={() => setEditing("new")}>Configurar integración</Button> : undefined} />
    {business.role === "operator" && <div className="alert">Puedes probar la conexión de Mercado Pago. Editar integraciones requiere rol owner o admin.</div>}{query.isLoading ? <Spinner /> : query.isError ? <div className="alert error">{errorMessage(query.error)}</div> : !query.data?.length ? <EmptyState title="No hay integraciones configuradas." /> : <div className="table-card"><div className="table-scroll"><table><thead><tr><th>Proveedor</th><th>Estado</th><th>Configuración pública</th><th>Credenciales</th><th /></tr></thead><tbody>{query.data.map((item) => <tr key={item.id}><td>{item.providerKey}</td><td><StatusBadge value={item.status} /></td><td><code>{JSON.stringify(item.config)}</code>{item.providerKey === "mercado_pago" && <><br /><small>Webhook: {mercadoPagoWebhookUrl(item.id)}</small></>}</td><td>Configurado · ********</td><td><div className="table-actions">{item.providerKey === "mercado_pago" && <Button className="secondary small" disabled={testConnection.isPending && testConnection.variables === item.id} onClick={() => testConnection.mutate(item.id)}>{testConnection.isPending && testConnection.variables === item.id ? "Probando…" : "Probar conexión"}</Button>}{business.role !== "operator" && <Button className="secondary small" onClick={() => setEditing(item)}>Editar</Button>}{testResults[item.id] && <span className={testResults[item.id].ok ? "status status-active" : "alert error"} role="status">{testResults[item.id].message}</span>}</div></td></tr>)}</tbody></table></div><Pagination offset={offset} limit={25} count={query.data.length} onChange={setOffset} /></div>}
    {editing && <IntegrationForm record={editing} pending={mutation.isPending} error={mutation.isError ? errorMessage(mutation.error) : ""} onClose={() => setEditing(null)} onSave={(body) => mutation.mutate({ record: editing, body })} />}
  </>;
}

export function IntegrationForm({ record, pending, error, onClose, onSave }: { record: Integration | "new"; pending: boolean; error: string; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const [providerKey, setProviderKey] = useState(record === "new" ? "mercado_pago" : record.providerKey); const [formError, setFormError] = useState(""); const creating = record === "new"; const config = creating ? {} : record.config;
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setFormError(""); const data = new FormData(event.currentTarget); if (!creating && data.get("status") === "inactive" && record.status === "active" && !window.confirm("¿Desactivar esta integración?")) return; try { onSave(integrationPayload(event.currentTarget, providerKey, creating)); } catch (caught) { setFormError(caught instanceof Error ? caught.message : "Revisa el JSON y las credenciales requeridas."); } }
  return <Modal title={creating ? "Configurar integración" : `Editar ${providerKey}`} onClose={onClose}><form onSubmit={submit} autoComplete="off">{creating ? <><SelectField label="Proveedor" value={knownProviders.includes(providerKey) ? providerKey : "generic"} onChange={(event) => setProviderKey(event.target.value === "generic" ? "" : event.target.value)}><option value="mercado_pago">Mercado Pago</option><option value="smm_raja">SMM Raja</option><option value="telegram">Telegram (revisión humana)</option><option value="automation_runner">Automation Runner (n8n)</option><option value="generic">Otro proveedor</option></SelectField>{!knownProviders.includes(providerKey) && <Field label="provider_key" value={providerKey} onChange={(event) => setProviderKey(event.target.value)} required pattern="[a-z0-9][a-z0-9_]*" />}</> : <SelectField label="Estado" name="status" defaultValue={record.status}><option value="active">Activo</option><option value="inactive">Inactivo</option></SelectField>}
      {providerKey === "mercado_pago" && <>
        {record !== "new" && <Field label="Webhook URL para Mercado Pago" value={mercadoPagoWebhookUrl(record.id)} readOnly hint="Registra esta URL en Mercado Pago Developers para el evento Pagos." />}
        <Field label="Success URL (opcional)" name="successUrl" type="url" defaultValue={String(config.successUrl ?? "")} hint="Déjala vacía si todavía no existe una página de resultado." />
        <Field label="Pending URL (opcional)" name="pendingUrl" type="url" defaultValue={String(config.pendingUrl ?? "")} />
        <Field label="Failure URL (opcional)" name="failureUrl" type="url" defaultValue={String(config.failureUrl ?? "")} hint="Completa las tres URL juntas o deja las tres vacías." />
        <Field label={creating ? "Public Key" : "Reingresar Public Key (solo al actualizar credenciales)"} name="publicKey" autoComplete="off" required={creating} />
        <Field label={creating ? "Access Token" : "Reingresar Access Token (solo al actualizar credenciales)"} name="accessToken" type="password" autoComplete="new-password" required={creating} />
        <Field label={creating ? "Webhook Secret (se configura después)" : "Webhook Secret nuevo"} name="webhookSecret" type="password" autoComplete="new-password" hint={creating ? "La integración se guardará inactiva y el panel mostrará la URL del webhook." : "Para activarla, reingresa también Public Key y Access Token."} />
      </>}
      {providerKey === "smm_raja" && <Field label={creating ? "API key" : "Nueva API key (opcional)"} name="apiKey" type="password" autoComplete="new-password" required={creating} />}
      {providerKey === "telegram" && <><Field label="Bot Token de Telegram" name="botToken" type="password" autoComplete="new-password" required={creating} /><Field label="Webhook Secret de Telegram" name="webhookSecret" type="password" minLength={32} autoComplete="new-password" required={creating} /><p className="muted">Usa el mismo bot que tu credencial Telegram Ventas Admin en n8n. Para rotar las credenciales completa ambos campos.</p></>}
      {providerKey === "automation_runner" && <Field label="Runner Secret (32 caracteres o más)" name="runnerSecret" type="password" minLength={32} autoComplete="new-password" required={creating} />}
      {!knownProviders.includes(providerKey) && providerKey !== "" && <><TextAreaField label="Config JSON (sin secretos)" name="configJson" defaultValue={creating ? "{}" : JSON.stringify(config, null, 2)} /><TextAreaField label={creating ? "Credentials JSON" : "Nuevas credentials JSON (opcional)"} name="credentialsJson" required={creating} /></>}
      {!creating && <p className="muted">Credenciales actuales: configuradas · ********. Solo se reemplazan si completas un campo nuevo.</p>}{(formError || error) && <div className="alert error">{formError || error}</div>}<div className="form-actions"><Button className="secondary" type="button" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={pending || !providerKey}>Guardar</Button></div></form></Modal>;
}
