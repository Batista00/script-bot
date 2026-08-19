import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { businessQueryKey } from "../../app/query-client";
import { Button, DetailGrid, EmptyState, Field, Modal, PageHeader, Pagination, SelectField, Spinner, StatusBadge, useToast } from "../../components/ui";
import { errorMessage } from "../../lib/api/client";
import { customersApi, productsApi, quotesApi } from "../../lib/api/resources";
import type { Quote } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";

export function QuotesPage() {
  const business = useBusiness(); const client = useQueryClient(); const toast = useToast();
  const [offset, setOffset] = useState(0); const [detail, setDetail] = useState<Quote | null>(null); const [creating, setCreating] = useState(false);
  const quotes = useQuery({ queryKey: businessQueryKey("quotes", business.id, { offset }), queryFn: () => quotesApi.list(business.id, { limit: 25, offset }) });
  const products = useQuery({ queryKey: businessQueryKey("products", business.id, "quote-options"), queryFn: () => productsApi.list(business.id, { limit: 100, offset: 0, status: "active" }) });
  const customers = useQuery({ queryKey: businessQueryKey("customers", business.id, "quote-options"), queryFn: () => customersApi.list(business.id, { limit: 100, offset: 0 }) });
  const create = useMutation({ mutationFn: (body: unknown) => quotesApi.create(business.id, body), onSuccess: async () => { setCreating(false); await client.invalidateQueries({ queryKey: ["quotes", business.id] }); toast("Cotización creada por el backend."); } });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const customerId = String(data.get("customerId")); const expiresAt = String(data.get("expiresAt")); create.mutate({ productId: String(data.get("productId")), quantity: Number(data.get("quantity")), currency: String(data.get("currency")).toUpperCase(), customerId: customerId || null, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null }); }
  return <><PageHeader title="Cotizaciones" description="Snapshots y totales calculados exclusivamente por Pricing Core." action={<Button onClick={() => setCreating(true)} disabled={!products.data?.length}>Crear cotización</Button>} />
    {quotes.isLoading ? <Spinner /> : !quotes.data?.length ? <EmptyState title="No hay cotizaciones." /> : <div className="table-card"><div className="table-scroll"><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Total</th><th>Estado</th><th>Expira</th><th /></tr></thead><tbody>{quotes.data.map((quote) => <tr key={quote.id}><td>{quote.productName}</td><td>{quote.quantity}</td><td>{quote.totalPrice} {quote.currency}</td><td><StatusBadge value={quote.status} /></td><td>{quote.expiresAt ? new Date(quote.expiresAt).toLocaleString() : "—"}</td><td><Button className="secondary small" onClick={() => setDetail(quote)}>Ver</Button></td></tr>)}</tbody></table></div><Pagination offset={offset} limit={25} count={quotes.data.length} onChange={setOffset} /></div>}
    {detail && <Modal title="Detalle de cotización" onClose={() => setDetail(null)}><DetailGrid record={detail as unknown as Record<string, unknown>} /></Modal>}
    {creating && <Modal title="Crear cotización" onClose={() => setCreating(false)}><form onSubmit={submit}><SelectField label="Producto" name="productId" required>{products.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField><SelectField label="Cliente (opcional)" name="customerId"><option value="">Sin cliente</option>{customers.data?.map((item) => <option key={item.id} value={item.id}>{item.name || item.email || item.id}</option>)}</SelectField><Field label="Cantidad" name="quantity" type="number" min="1" required /><Field label="Moneda" name="currency" defaultValue="CLP" minLength={3} maxLength={3} required /><Field label="Expiración (opcional)" name="expiresAt" type="datetime-local" />{create.isError && <div className="alert error">{errorMessage(create.error)}</div>}<div className="form-actions"><Button className="secondary" type="button" onClick={() => setCreating(false)}>Cancelar</Button><Button type="submit" disabled={create.isPending}>Crear</Button></div></form></Modal>}
  </>;
}
