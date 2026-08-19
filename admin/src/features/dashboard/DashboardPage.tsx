import { useQuery } from "@tanstack/react-query";
import { businessQueryKey } from "../../app/query-client";
import { EmptyState, PageHeader, Spinner, StatusBadge } from "../../components/ui";
import { customersApi, fulfillmentsApi, ordersApi, paymentsApi, productsApi } from "../../lib/api/resources";
import { useBusiness } from "../businesses/business-context";

export function DashboardPage() {
  const business = useBusiness();
  const customers = useQuery({ queryKey: businessQueryKey("customers", business.id, "dashboard"), queryFn: () => customersApi.list(business.id, { limit: 5, offset: 0 }) });
  const products = useQuery({ queryKey: businessQueryKey("products", business.id, "dashboard"), queryFn: () => productsApi.list(business.id, { limit: 5, offset: 0 }) });
  const orders = useQuery({ queryKey: businessQueryKey("orders", business.id, "dashboard"), queryFn: () => ordersApi.list(business.id, { limit: 5, offset: 0 }) });
  const payments = useQuery({ queryKey: businessQueryKey("payments", business.id, "dashboard"), queryFn: () => paymentsApi.list(business.id, { limit: 5, offset: 0 }) });
  const attention = useQuery({ queryKey: businessQueryKey("fulfillments", business.id, "dashboard-attention"), queryFn: () => fulfillmentsApi.list(business.id, { limit: 5, offset: 0, status: "submission_unknown" }) });
  const loading = [customers, products, orders, payments, attention].some((query) => query.isLoading);
  const failed = [customers, products, orders, payments, attention].some((query) => query.isError);
  return <><PageHeader title="Dashboard" description={`Visión operativa reciente de ${business.name}. Los conteos indican filas cargadas, no totales globales.`} />
    {failed && <div className="alert error">No fue posible cargar una o más secciones del dashboard.</div>}
    {loading ? <Spinner /> : <div className="dashboard-grid">
      <Summary title="Clientes recientes" rows={customers.data?.map((item) => item.name || item.email || item.phone || item.id)} />
      <Summary title="Productos recientes" rows={products.data?.map((item) => item.name)} />
      <Summary title="Pedidos recientes" rows={orders.data?.map((item) => <span key={item.id}><code>{item.id.slice(0, 8)}</code> <StatusBadge value={item.status} /></span>)} />
      <Summary title="Pagos recientes" rows={payments.data?.map((item) => <span key={item.id}>{item.providerKey} <StatusBadge value={item.status} /></span>)} />
      <Summary title="Fulfillments que requieren revisión" attention rows={attention.data?.map((item) => <span key={item.id}><code>{item.id.slice(0, 8)}</code> <StatusBadge value={item.status} /></span>)} />
    </div>}
  </>;
}
function Summary({ title, rows = [], attention = false }: { title: string; rows?: React.ReactNode[]; attention?: boolean }) {
  return <section className={`summary-card ${attention ? "attention" : ""}`}><header><h2>{title}</h2><span>{rows.length} cargados</span></header>{rows.length ? <ul>{rows.map((row, index) => <li key={index}>{row}</li>)}</ul> : <EmptyState title="Sin registros recientes." />}</section>;
}
