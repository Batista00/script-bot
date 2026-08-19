import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { businessQueryKey } from "../../app/query-client";
import { EmptyState, SelectField, Spinner } from "../../components/ui";
import { pricingApi, productsApi } from "../../lib/api/resources";
import type { Price } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";
import { cell, EntityPage } from "../shared/EntityPage";

export function PricingPage() {
  const business = useBusiness(); const [selected, setSelected] = useState("");
  const products = useQuery({ queryKey: businessQueryKey("products", business.id, "pricing-options"), queryFn: () => productsApi.list(business.id, { limit: 100, offset: 0 }) });
  if (products.isLoading) return <Spinner />;
  const productId = selected || products.data?.[0]?.id || "";
  if (!productId) return <EmptyState title="Crea un producto antes de configurar precios." />;
  return <div className="stack"><div className="filter-bar"><SelectField label="Producto" value={productId} onChange={(event) => setSelected(event.target.value)}>{products.data?.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</SelectField></div>
    <EntityPage<Price> resource="pricing" scopeKey={productId} title="Precios" description="Reglas vigentes calculadas y validadas por el backend." empty="Este producto no tiene precios."
      list={(_businessId, query) => pricingApi.list(business.id, productId, query)}
      create={(_businessId, body) => pricingApi.create(business.id, productId, body)}
      update={(_businessId, priceId, body) => pricingApi.update(business.id, productId, priceId, body)}
      columns={[{ label: "Tipo", value: (item) => item.pricingType }, { label: "Moneda", value: (item) => item.currency }, { label: "Precio fijo", value: (item) => cell.text(item.fixedPrice) }, { label: "Precio unitario", value: (item) => cell.text(item.unitPrice) }, { label: "Rango", value: (item) => `${cell.text(item.minQuantity)} – ${cell.text(item.maxQuantity)}` }, { label: "Estado", value: (item) => cell.status(item.status) }]}
      fields={[
        { name: "pricingType", label: "Tipo de precio", kind: "select", required: true, options: [{ value: "fixed", label: "Fijo" }, { value: "unit", label: "Por unidad" }] },
        { name: "currency", label: "Moneda (ISO 4217)", required: true },
        { name: "fixedPrice", label: "Precio fijo (unidad menor)", kind: "number", nullable: true },
        { name: "unitPrice", label: "Precio unitario (unidad menor)", kind: "number", nullable: true },
        { name: "minQuantity", label: "Cantidad mínima", kind: "number", nullable: true },
        { name: "maxQuantity", label: "Cantidad máxima", kind: "number", nullable: true },
        { name: "status", label: "Estado", kind: "select", editOnly: true, options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] },
      ]} />
  </div>;
}
