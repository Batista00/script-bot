import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { businessQueryKey } from "../../app/query-client";
import { Button, EmptyState, PageHeader, SelectField, Spinner, StatusBadge, useToast } from "../../components/ui";
import { ApiError, errorMessage } from "../../lib/api/client";
import { productsApi, providerApi } from "../../lib/api/resources";
import type { Product, ProviderService } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";

export function MappingsPage() {
  const business = useBusiness();
  const products = useQuery({ queryKey: businessQueryKey("products", business.id, "mapping-list"), queryFn: () => productsApi.list(business.id, { limit: 100, offset: 0 }) });
  const services = useQuery({ queryKey: businessQueryKey("provider-services", business.id, "mapping-options"), queryFn: () => providerApi.list(business.id, { limit: 100, offset: 0, providerStatus: "active" }) });
  return <><PageHeader title="Mapeos" description="Relaciona cada Product propio con un Provider Service sin alterar el precio comercial." />{products.isLoading || services.isLoading ? <Spinner /> : !products.data?.length ? <EmptyState title="No hay productos para mapear." /> : <div className="mapping-grid">{products.data.map((product) => <MappingCard key={product.id} product={product} services={services.data ?? []} />)}</div>}</>;
}
function MappingCard({ product, services }: { product: Product; services: ProviderService[] }) {
  const business = useBusiness(); const client = useQueryClient(); const toast = useToast();
  const query = useQuery({ queryKey: businessQueryKey("mapping", business.id, product.id), queryFn: async () => { try { return await providerApi.mapping(business.id, product.id); } catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; } }, retry: false });
  const mutation = useMutation({ mutationFn: ({ providerServiceId, status }: { providerServiceId: string; status?: "active" | "inactive" }) => query.data ? providerApi.updateMapping(business.id, product.id, { providerServiceId, status: status ?? "active" }) : providerApi.createMapping(business.id, product.id, providerServiceId), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["mapping", business.id, product.id] }); toast("Mapeo actualizado."); } });
  const current = services.find((service) => service.id === query.data?.providerServiceId);
  return <article className="mapping-card"><header><div><h2>{product.name}</h2><small>{product.type}</small></div>{query.data ? <StatusBadge value={query.data.status} /> : <span className="muted">Sin mapeo</span>}</header>{query.isLoading ? <Spinner /> : <><p>{current ? `${current.providerKey} · ${current.name} · ${current.externalServiceId}` : "Selecciona un servicio activo."}</p>{business.role !== "operator" && <div className="inline-form"><SelectField label="Provider Service" defaultValue={query.data?.providerServiceId ?? ""} onChange={(event) => { if (event.target.value) mutation.mutate({ providerServiceId: event.target.value }); }}><option value="">Seleccionar…</option>{services.map((service) => <option key={service.id} value={service.id}>{service.providerKey} · {service.name} ({service.externalServiceId})</option>)}</SelectField>{query.data && <Button className="secondary" onClick={() => mutation.mutate({ providerServiceId: query.data!.providerServiceId, status: query.data!.status === "active" ? "inactive" : "active" })}>{query.data.status === "active" ? "Desactivar" : "Activar"}</Button>}</div>}{mutation.isError && <div className="alert error">{errorMessage(mutation.error)}</div>}</>}</article>;
}
