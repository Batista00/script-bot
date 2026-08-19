import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { businessQueryKey } from "../../app/query-client";
import { Button, DetailGrid, EmptyState, Modal, PageHeader, Pagination, SelectField, Spinner, StatusBadge, useToast } from "../../components/ui";
import { errorMessage } from "../../lib/api/client";
import { ordersApi } from "../../lib/api/resources";
import type { Order } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";

const statuses = ["", "pending_payment", "paid", "processing", "completed", "cancelled", "failed"];
export function OrdersPage() {
  const business = useBusiness(); const client = useQueryClient(); const toast = useToast();
  const [offset, setOffset] = useState(0); const [status, setStatus] = useState(""); const [detail, setDetail] = useState<Order | null>(null);
  const query = useQuery({ queryKey: businessQueryKey("orders", business.id, { offset, status }), queryFn: () => ordersApi.list(business.id, { limit: 25, offset, status }) });
  const cancel = useMutation({ mutationFn: (id: string) => ordersApi.cancel(business.id, id), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["orders", business.id] }); setDetail(null); toast("Pedido cancelado."); } });
  const canCancel = business.role !== "operator";
  return <><PageHeader title="Pedidos" description="Órdenes convertidas desde cotizaciones; no admite edición financiera manual." /><div className="filter-bar"><SelectField label="Estado" value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }}>{statuses.map((value) => <option key={value} value={value}>{value || "Todos"}</option>)}</SelectField></div>
    {query.isLoading ? <Spinner /> : query.isError ? <div className="alert error">{errorMessage(query.error)}</div> : !query.data?.length ? <EmptyState title="No hay pedidos." /> : <div className="table-card"><div className="table-scroll"><table><thead><tr><th>ID</th><th>Cliente</th><th>Total</th><th>Estado</th><th>Creado</th><th /></tr></thead><tbody>{query.data.map((order) => <tr key={order.id}><td><code>{order.id.slice(0, 8)}</code></td><td><code>{order.customerId.slice(0, 8)}</code></td><td>{order.total} {order.currency}</td><td><StatusBadge value={order.status} /></td><td>{new Date(order.createdAt).toLocaleString()}</td><td><Button className="secondary small" onClick={() => setDetail(order)}>Ver</Button></td></tr>)}</tbody></table></div><Pagination offset={offset} limit={25} count={query.data.length} onChange={setOffset} /></div>}
    {detail && <Modal title="Detalle del pedido" onClose={() => setDetail(null)}><DetailGrid record={detail as unknown as Record<string, unknown>} />{canCancel && detail.status === "pending_payment" && <div className="danger-zone"><Button className="danger" disabled={cancel.isPending} onClick={() => { if (window.confirm("¿Cancelar este pedido? Esta acción respeta las reglas del backend.")) cancel.mutate(detail.id); }}>Cancelar pedido</Button></div>}{cancel.isError && <div className="alert error">{errorMessage(cancel.error)}</div>}</Modal>}
  </>;
}
