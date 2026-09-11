import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { businessQueryKey } from "../../app/query-client";
import { EmptyState, Field, PageHeader, Pagination, Spinner } from "../../components/ui";
import { errorMessage } from "../../lib/api/client";
import { productsApi } from "../../lib/api/resources";
import { useBusiness } from "../businesses/business-context";
import { ProductProviderMapping } from "./ProductProviderMapping";

export const MAPPING_PRODUCT_PAGE_SIZE = 25;

export function MappingsPage() {
  const business = useBusiness();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const products = useQuery({
    queryKey: businessQueryKey("products", business.id, "mapping-list", { search, offset }),
    queryFn: () => productsApi.list(business.id, {
      limit: MAPPING_PRODUCT_PAGE_SIZE, offset,
      ...(search.trim() ? { search: search.trim() } : {}),
    }),
  });
  return <><PageHeader title="Vínculos de entrega" description="El mismo editor está disponible al editar un producto. Cambia el servicio externo, no el precio ni las órdenes históricas." />
    <Field label="Buscar producto por nombre o SKU" maxLength={160} value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />
    {products.isLoading ? <Spinner /> : products.isError ? <div className="alert error">{errorMessage(products.error)}</div> : !products.data?.length ? <EmptyState title="No hay productos para vincular." /> :
      <div className="mapping-grid">{products.data.map((product) => <ProductProviderMapping key={product.id} product={product} />)}</div>}
    <Pagination offset={offset} limit={MAPPING_PRODUCT_PAGE_SIZE} count={products.data?.length ?? 0} onChange={setOffset} />
  </>;
}
