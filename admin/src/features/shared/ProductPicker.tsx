import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { businessQueryKey } from "../../app/query-client";
import { Field, Pagination, SelectField, Spinner } from "../../components/ui";
import { productsApi } from "../../lib/api/resources";
import { useBusiness } from "../businesses/business-context";

export const PRODUCT_PICKER_LIMIT = 25;

/**
 * Product selector that no longer relies on the first 100 products: it searches
 * on the server (forward compatible `search`) and paginates with `limit`/`offset`.
 * It also filters the returned page by name so the control stays usable while a
 * backend deployment does not implement `search` yet.
 */
export function ProductPicker({ label = "Producto", value, onChange, autoSelect = true }: {
  label?: string;
  value: string;
  onChange: (productId: string) => void;
  autoSelect?: boolean;
}) {
  const business = useBusiness();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: businessQueryKey("products", business.id, "picker", { offset, search }),
    queryFn: () => productsApi.list(business.id, {
      limit: PRODUCT_PICKER_LIMIT, offset, status: "active",
      search: search.trim() || undefined,
    }),
  });
  const term = search.trim().toLowerCase();
  const page = query.data ?? [];
  const products = term === "" ? page : page.filter((product) => product.name.toLowerCase().includes(term));
  const selectedMissing = value !== "" && !products.some((product) => product.id === value);
  useEffect(() => {
    if (!autoSelect || value !== "" || !query.data?.length) return;
    onChange(query.data[0]!.id);
  }, [autoSelect, query.data, value, onChange]);
  return <div className="filter-bar">
    <Field label="Buscar producto" value={search} placeholder="Nombre del producto"
      onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />
    {query.isLoading ? <Spinner /> : <SelectField label={label} value={value}
      onChange={(event) => onChange(event.target.value)}>
      {value === "" && <option value="">Selecciona un producto</option>}
      {selectedMissing && <option value={value}>Producto seleccionado actual</option>}
      {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
    </SelectField>}
    <Pagination offset={offset} limit={PRODUCT_PICKER_LIMIT} count={page.length} onChange={setOffset} />
  </div>;
}
