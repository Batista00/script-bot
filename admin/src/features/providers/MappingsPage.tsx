import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { businessQueryKey } from "../../app/query-client";
import { Button, EmptyState, Field, PageHeader, Pagination, SelectField, Spinner, StatusBadge, useToast } from "../../components/ui";
import { ApiError, errorMessage } from "../../lib/api/client";
import { productsApi, providerApi } from "../../lib/api/resources";
import type { Product, ProviderService } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";

export const MAPPING_PRODUCT_PAGE_SIZE = 25;

export function MappingsPage() {
  const business = useBusiness();
  const [productOffset, setProductOffset] = useState(0);
  const [productSearch, setProductSearch] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const products = useQuery({
    queryKey: businessQueryKey("products", business.id, "mapping-list", { offset: productOffset, search: productSearch }),
    queryFn: () => productsApi.list(business.id, {
      limit: MAPPING_PRODUCT_PAGE_SIZE, offset: productOffset,
      search: productSearch.trim() || undefined,
    }),
  });
  const services = useQuery({
    queryKey: businessQueryKey("provider-services", business.id, "mapping-options", { search: serviceSearch }),
    queryFn: () => providerApi.list(business.id, {
      limit: 100, offset: 0, providerStatus: "active",
      search: serviceSearch.trim() || undefined,
    }),
  });
  const term = productSearch.trim().toLowerCase();
  const productPage = products.data ?? [];
  const visibleProducts = term === "" ? productPage : productPage.filter((product) => product.name.toLowerCase().includes(term));
  return <><PageHeader title="Mapeos" description="Relaciona cada Product propio con un Provider Service sin alterar el precio comercial." />
    <div className="filter-bar">
      <Field label="Buscar producto" value={productSearch} placeholder="Nombre del producto"
        onChange={(event) => { setProductSearch(event.target.value); setProductOffset(0); }} />
      <Field label="Buscar servicio de proveedor" value={serviceSearch} placeholder="ID, nombre o categoría"
        onChange={(event) => setServiceSearch(event.target.value)} />
      <Pagination offset={productOffset} limit={MAPPING_PRODUCT_PAGE_SIZE} count={productPage.length} onChange={setProductOffset} />
    </div>
    {products.isLoading || services.isLoading ? <Spinner /> : !productPage.length ? <EmptyState title="No hay productos para mapear." /> : !visibleProducts.length ? <EmptyState title="Ningún producto coincide con la búsqueda." /> : <div className="mapping-grid">{visibleProducts.map((product) => <MappingCard key={product.id} product={product} services={services.data ?? []} />)}</div>}</>;
}
function MappingCard({ product, services }: { product: Product; services: ProviderService[] }) {
  const business = useBusiness(); const client = useQueryClient(); const toast = useToast();
  const query = useQuery({ queryKey: businessQueryKey("mapping", business.id, product.id), queryFn: async () => { try { return await providerApi.mapping(business.id, product.id); } catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; } }, retry: false });
  const mutation = useMutation({ mutationFn: ({ providerServiceId, status }: { providerServiceId: string; status?: "active" | "inactive" }) => query.data ? providerApi.updateMapping(business.id, product.id, { providerServiceId, status: status ?? "active" }) : providerApi.createMapping(business.id, product.id, providerServiceId), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["mapping", business.id, product.id] }); toast("Mapeo actualizado."); } });
  const current = services.find((service) => service.id === query.data?.providerServiceId);
  return <article className="mapping-card"><header><div><h2>{product.name}</h2><small>{product.type}</small></div>{query.data ? <StatusBadge value={query.data.status} /> : <span className="muted">Sin mapeo</span>}</header>{query.isLoading ? <Spinner /> : <><p>{current ? `${current.providerKey} · ${current.name} · ${current.externalServiceId}` : "Selecciona un servicio activo."}</p>{business.role !== "operator" && <div className="inline-form"><SelectField label="Provider Service" defaultValue={query.data?.providerServiceId ?? ""} onChange={(event) => { if (event.target.value) mutation.mutate({ providerServiceId: event.target.value }); }}><option value="">Seleccionar…</option>{services.map((service) => <option key={service.id} value={service.id}>{service.providerKey} · {service.name} ({service.externalServiceId})</option>)}</SelectField>{query.data && <Button className="secondary" onClick={() => mutation.mutate({ providerServiceId: query.data!.providerServiceId, status: query.data!.status === "active" ? "inactive" : "active" })}>{query.data.status === "active" ? "Desactivar" : "Activar"}</Button>}</div>}{mutation.isError && <div className="alert error">{errorMessage(mutation.error)}</div>}</>}</article>;
}
