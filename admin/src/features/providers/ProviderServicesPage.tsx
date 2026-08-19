import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { businessQueryKey } from "../../app/query-client";
import { Button, EmptyState, PageHeader, Pagination, SelectField, Spinner, StatusBadge, useToast } from "../../components/ui";
import { errorMessage } from "../../lib/api/client";
import { integrationsApi, providerApi } from "../../lib/api/resources";
import { useBusiness } from "../businesses/business-context";

export function ProviderServicesPage() {
  const business = useBusiness(); const client = useQueryClient(); const toast = useToast();
  const [offset, setOffset] = useState(0); const [providerStatus, setProviderStatus] = useState(""); const [integrationId, setIntegrationId] = useState("");
  const integrations = useQuery({ queryKey: businessQueryKey("integrations", business.id, "provider-options"), queryFn: () => integrationsApi.list(business.id, { limit: 100, offset: 0 }) });
  const services = useQuery({ queryKey: businessQueryKey("provider-services", business.id, { offset, providerStatus, integrationId }), queryFn: () => providerApi.list(business.id, { limit: 25, offset, providerStatus, integrationId }) });
  const sync = useMutation({ mutationFn: () => providerApi.sync(business.id, integrationId), onSuccess: async (result) => { await client.invalidateQueries({ queryKey: ["provider-services", business.id] }); toast(`Sync: ${result.received} recibidos, ${result.created} creados, ${result.updated} actualizados.`); } });
  return <><PageHeader title="Servicios de proveedor" description="Catálogo técnico separado de Products y retail pricing." action={business.role !== "operator" ? <Button disabled={!integrationId || sync.isPending} onClick={() => sync.mutate()}>Sincronizar servicios</Button> : undefined} /><div className="filter-bar"><SelectField label="Integración" value={integrationId} onChange={(event) => { setIntegrationId(event.target.value); setOffset(0); }}><option value="">Todas</option>{integrations.data?.map((item) => <option key={item.id} value={item.id}>{item.providerKey}</option>)}</SelectField><SelectField label="Estado proveedor" value={providerStatus} onChange={(event) => { setProviderStatus(event.target.value); setOffset(0); }}><option value="">Todos</option><option value="active">Activo</option><option value="inactive">Inactivo</option></SelectField></div>
    {sync.isError && <div className="alert error">{errorMessage(sync.error)}</div>}{services.isLoading ? <Spinner /> : services.isError ? <div className="alert error">{errorMessage(services.error)}</div> : !services.data?.length ? <EmptyState title="No hay servicios sincronizados." /> : <div className="table-card"><div className="table-scroll"><table><thead><tr><th>Proveedor</th><th>ID externo</th><th>Nombre</th><th>Categoría / tipo</th><th>Rate</th><th>Min / max</th><th>Estado</th><th>Último sync</th></tr></thead><tbody>{services.data.map((item) => <tr key={item.id}><td>{item.providerKey}</td><td><code>{item.externalServiceId}</code></td><td>{item.name}</td><td>{item.category || "—"} / {item.serviceType || "—"}</td><td>{item.rate ?? "—"} {item.rateCurrency ?? ""}</td><td>{item.minQuantity ?? "—"} / {item.maxQuantity ?? "—"}</td><td><StatusBadge value={item.providerStatus} /></td><td>{new Date(item.lastSyncedAt).toLocaleString()}</td></tr>)}</tbody></table></div><Pagination offset={offset} limit={25} count={services.data.length} onChange={setOffset} /></div>}
  </>;
}
