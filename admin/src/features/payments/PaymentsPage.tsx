import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { businessQueryKey } from "../../app/query-client";
import { Button, DetailGrid, EmptyState, Field, Modal, PageHeader, Pagination, SelectField, Spinner, StatusBadge, useToast } from "../../components/ui";
import { errorMessage } from "../../lib/api/client";
import { paymentsApi } from "../../lib/api/resources";
import type { Payment } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";

export function PaymentsPage() {
  const business = useBusiness(); const client = useQueryClient(); const toast = useToast();
  const [offset, setOffset] = useState(0); const [status, setStatus] = useState("");
  const [orderId, setOrderId] = useState(""); const [detail, setDetail] = useState<Payment | null>(null);
  const query = useQuery({ queryKey: businessQueryKey("payments", business.id, { offset, status, orderId }), queryFn: () => paymentsApi.list(business.id, { limit: 25, offset, status, orderId }) });
  const confirm = useMutation({
    mutationFn: ({ id, reference }: { id: string; reference: string }) => paymentsApi.confirmBankTransfer(business.id, id, reference),
    onSuccess: async (payment) => { setDetail(payment); await client.invalidateQueries({ queryKey: ["payments", business.id] }); toast("Transferencia confirmada y pedido marcado como pagado."); },
  });
  function confirmTransfer(payment: Payment) {
    const reference = window.prompt("Ingresa la referencia o comprobante verificado de la transferencia:");
    if (!reference?.trim()) return;
    if (window.confirm("Confirma que una persona verificó el abono correcto. Esta acción aprobará el pago.")) confirm.mutate({ id: payment.id, reference });
  }
  return <><PageHeader title="Pagos" description="Mercado Pago se confirma por webhook. Las transferencias solo pueden aprobarlas owner/admin tras verificar el abono." /><div className="filter-bar"><SelectField label="Estado" value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }}><option value="">Todos</option>{["pending", "approved", "rejected", "cancelled", "expired", "failed"].map((value) => <option key={value}>{value}</option>)}</SelectField><Field label="Order ID" value={orderId} onChange={(event) => { setOrderId(event.target.value); setOffset(0); }} placeholder="UUID exacto" /></div>
    {(query.isError || confirm.isError) && <div className="alert error">{errorMessage(query.error ?? confirm.error)}</div>}
    {query.isLoading ? <Spinner /> : !query.data?.length ? <EmptyState title="No hay pagos." /> : <div className="table-card"><div className="table-scroll"><table><thead><tr><th>ID</th><th>Order</th><th>Método</th><th>Monto</th><th>Estado</th><th /></tr></thead><tbody>{query.data.map((payment) => <tr key={payment.id}><td><code>{payment.id.slice(0, 8)}</code></td><td><code>{payment.orderId.slice(0, 8)}</code></td><td>{payment.providerKey}</td><td>{payment.amount} {payment.currency}</td><td><StatusBadge value={payment.status} /></td><td><div className="table-actions"><Button className="secondary small" onClick={() => setDetail(payment)}>Ver</Button>{business.role !== "operator" && payment.providerKey === "bank_transfer" && payment.status === "pending" && <Button className="small" disabled={confirm.isPending} onClick={() => confirmTransfer(payment)}>Confirmar abono</Button>}</div></td></tr>)}</tbody></table></div><Pagination offset={offset} limit={25} count={query.data.length} onChange={setOffset} /></div>}
    {detail && <Modal title="Detalle del pago" onClose={() => setDetail(null)}><DetailGrid record={detail as unknown as Record<string, unknown>} />{detail.checkoutUrl && <a className="button link-button" href={detail.checkoutUrl} target="_blank" rel="noreferrer">Abrir checkout</a>}</Modal>}
  </>;
}
