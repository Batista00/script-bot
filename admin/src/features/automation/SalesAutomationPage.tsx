import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button, EmptyState, Field, PageHeader, StatusBadge } from "../../components/ui";
import { apiRequest, errorMessage } from "../../lib/api/client";
import { integrationsApi } from "../../lib/api/resources";
import { useBusiness } from "../businesses/business-context";
import { HumanResolutionModal } from "./HumanResolutionModal";
import type { HumanOutcome, SalesAdminSession, SalesMutationInput, SalesOverview, SalesSettings } from "./sales-automation.types";
import { SalesSettingsForm } from "./SalesSettingsForm";
import { ShippingQuoteModal } from "./ShippingQuoteModal";

const phaseLabels: Record<string, string> = {
  browse: "Buscando producto", quantity: "Definiendo cantidad", inputs: "Recopilando datos",
  confirm: "Confirmando compra", payment: "Seleccionando pago", awaiting: "Esperando pago",
  delivery: "Definiendo entrega",
};

export function SalesAutomationPage() {
  const business = useBusiness();
  const client = useQueryClient();
  const [resolutionSession, setResolutionSession] = useState<SalesAdminSession | null>(null);
  const [shippingSession,setShippingSession]=useState<SalesAdminSession|null>(null);
  const path = `/businesses/${business.id}/sales-automation`;
  const queryKey = ["sales-automation", business.id];
  const permitted = business.role !== "operator";
  const query = useQuery({ queryKey, queryFn: () => apiRequest<SalesOverview>(path), enabled: permitted });
  const integrations = useQuery({
    queryKey: ["integrations", business.id, "sales-status"],
    queryFn: () => integrationsApi.list(business.id, { limit: 100, offset: 0 }),
    enabled: permitted,
  });
  const mutation = useMutation({
    mutationFn: ({ suffix = "", method = "POST", body }: SalesMutationInput) => apiRequest(path + suffix, { method, body }),
    onSuccess: async () => { setResolutionSession(null); await client.invalidateQueries({ queryKey }); },
  });

  function configure(settings: SalesSettings) {
    if (settings.autoDispatch && !query.data?.settings.autoDispatch &&
      !window.confirm("¿Habilitar compras automáticas al proveedor después de pagos confirmados? Esto puede consumir saldo real.")) return;
    mutation.mutate({ method: "PUT", body: settings });
  }
  const integrationActive = (key: string) => integrations.data?.some((item) => item.providerKey === key && item.status === "active") ?? false;
  if (!permitted) return <div className="alert">Solo owner y admin pueden configurar ventas y revisores.</div>;

  return <><PageHeader title="Ventas por WhatsApp" description="Opera el canal, las derivaciones humanas y las entregas del negocio actual." />
    {(query.isError || mutation.isError) && !resolutionSession && <div className="alert error">{errorMessage(query.error ?? mutation.error)}</div>}
    {query.data && <div className="automation-layout">
      <section className="status-strip">
        <div><span>Recepción</span><StatusBadge value={query.data.settings.enabled ? "active" : "inactive"} /></div>
        <div><span>Telegram</span><StatusBadge value={integrationActive("telegram") ? "active" : "inactive"} /></div>
        <div><span>Ejecutor n8n</span><StatusBadge value={integrationActive("automation_runner") ? "active" : "inactive"} /></div>
        <div><span>Despacho proveedor</span><StatusBadge value={query.data.settings.autoDispatch ? "active" : "inactive"} /></div>
      </section>

      <SalesSettingsForm formKey={`${business.id}:${query.dataUpdatedAt}`} settings={query.data.settings}
        pending={mutation.isPending} onSubmit={configure} />

      <section className="form-card automation-card"><h2>Personas autorizadas en Telegram</h2>
        <p className="muted">El Chat ID recibe la alerta; estos IDs identifican quién puede aprobar una transferencia.</p>
        <form className="inline-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); mutation.mutate({ suffix: "/reviewers", body: { telegramUserId: String(form.get("telegramUserId")) } }); }}>
          <Field label="Mi ID numérico de usuario" name="telegramUserId" pattern="[0-9]{1,20}" required />
          <Button disabled={mutation.isPending}>Vincular</Button>
        </form>
        {query.data.reviewers.map(reviewer => <p key={reviewer.telegramUserId}><code>{reviewer.telegramUserId}</code> <Button className="secondary small" disabled={mutation.isPending}
          onClick={() => mutation.mutate({ suffix: "/reviewers", method: "DELETE", body: { telegramUserId: reviewer.telegramUserId } })}>Revocar</Button></p>)}
      </section>

      <section className="table-card automation-wide"><header className="card-heading"><div><h2>Conversaciones recientes</h2><p>Cuando un cliente pide una persona, Telegram recibe la alerta y el bot queda pausado.</p></div></header>
        {!query.data.sessions.length ? <EmptyState title="Todavía no hay conversaciones." /> : <div className="table-scroll"><table><thead><tr><th>Cliente</th><th>Etapa</th><th>Atención</th><th>Última actividad</th><th>Última gestión</th><th>Acciones</th></tr></thead>
          <tbody>{query.data.sessions.map(session => { const latest = session.resolutions?.at(-1); return <tr key={session.id}>
            <td>{session.contact}</td><td>{phaseLabels[session.phase ?? ""] ?? "Conversación"}</td>
            <td><StatusBadge value={session.paused ? "human" : "active"} /></td><td>{new Date(session.updatedAt).toLocaleString()}</td>
            <td>{latest ? `${latest.outcome.replaceAll("_", " ")} · ${latest.note}` : "—"}</td><td><div className="table-actions">
              {session.paused && <Button className="secondary small" onClick={() => setResolutionSession(session)}>Registrar gestión</Button>}
              {session.phase==="delivery"&&<Button className="secondary small" onClick={()=>setShippingSession(session)}>Cotizar envío</Button>}
              <Button className="secondary small" disabled={mutation.isPending} onClick={() => mutation.mutate({ suffix: `/sessions/${session.id}`, method: "PATCH", body: { paused: !session.paused } })}>{session.paused ? "Reanudar bot" : "Pausar bot"}</Button>
            </div></td></tr>; })}</tbody></table></div>}
      </section>

      <section className="table-card automation-wide"><header className="card-heading"><div><h2>Pedidos y entregas</h2><p>La entrega física se registra por el equipo; los digitales propios configurados se envían después del pago y los SMM usan su vínculo técnico.</p></div></header>
        {!query.data.checkouts.length ? <EmptyState title="No hay pedidos en seguimiento." /> : <div className="table-scroll"><table><thead><tr><th>Pedido</th><th>Entrega</th><th>Estado</th><th>Atención</th><th>Acción</th></tr></thead><tbody>
          {query.data.checkouts.map(checkout => <tr key={checkout.id}><td><code>{checkout.orderId.slice(0, 8)}</code></td><td>{checkout.mode === "manual" ? "Manual" : checkout.mode === "digital" ? "Digital propio" : "Proveedor"}</td><td><StatusBadge value={checkout.status ?? "pending"} /></td><td>{checkout.attentionCode ?? "—"}</td><td>
            {checkout.mode === "manual" && checkout.status === "paid" && <Button className="secondary small" disabled={mutation.isPending} onClick={() => { const note = window.prompt("Confirma la entrega e indica su referencia:"); if (note?.trim()) mutation.mutate({ suffix: `/checkouts/${checkout.id}/complete`, body: { note } }); }}>Registrar entrega</Button>}
          </td></tr>)}</tbody></table></div>}
      </section>

      <section className="form-card automation-card"><h2>Alertas operativas</h2>
        {!query.data.failures.length && !query.data.inboxFailures.length && !query.data.reviews.length && <p className="muted">No hay trabajos bloqueados ni comprobantes pendientes.</p>}
        {query.data.failures.map(failure => <p className="alert error" key={failure.id}>Notificación {failure.channel} agotó {failure.attempts} intentos. <Button className="small" disabled={mutation.isPending} onClick={() => { if (window.confirm("¿Reintentar? Comprueba antes si el mensaje ya llegó para evitar duplicados.")) mutation.mutate({ suffix: "/jobs/retry", body: { kind: "notifications", id: failure.id } }); }}>Reintentar</Button></p>)}
        {query.data.inboxFailures.map(failure => <p className="alert error" key={failure.id}>Mensaje de {failure.contact} bloqueado tras {failure.attempts} intentos. <Button className="small" disabled={mutation.isPending} onClick={() => mutation.mutate({ suffix: "/jobs/retry", body: { kind: "inbox", id: failure.id } })}>Reprocesar</Button></p>)}
        {query.data.reviews.map(review => <p key={review.id}>Comprobante <code>{review.id.slice(0, 8)}</code> — <StatusBadge value={review.status} /></p>)}
      </section>
    </div>}
    {resolutionSession && <HumanResolutionModal session={resolutionSession} pending={mutation.isPending}
      error={mutation.isError ? errorMessage(mutation.error) : null} onClose={() => setResolutionSession(null)}
      onSubmit={(body: { outcome: HumanOutcome; note: string; resumeBot: boolean }) => mutation.mutate({ suffix: `/sessions/${resolutionSession.id}/resolution`, body })} />}
    {shippingSession&&<ShippingQuoteModal session={shippingSession} onClose={()=>setShippingSession(null)} />}
  </>;
}
