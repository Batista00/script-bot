import { useState } from "react";
import { EmptyState } from "../../components/ui";
import { pricingApi } from "../../lib/api/resources";
import type { Price } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";
import { cell, EntityPage } from "../shared/EntityPage";
import { ProductPicker } from "../shared/ProductPicker";

export function PricingPage() {
  const business = useBusiness(); const [selected, setSelected] = useState("");
  return <div className="stack">
    <ProductPicker value={selected} onChange={setSelected} />
    {!selected ? <EmptyState title="Selecciona un producto para ver y editar sus precios." />
      : <EntityPage<Price> resource="pricing" scopeKey={selected} title="Precios" description="Reglas vigentes calculadas y validadas por el backend." empty="Este producto no tiene precios."
        list={(_businessId, query) => pricingApi.list(business.id, selected, query)}
        create={(_businessId, body) => pricingApi.create(business.id, selected, body)}
        update={(_businessId, priceId, body) => pricingApi.update(business.id, selected, priceId, body)}
        remove={(_businessId, priceId) => pricingApi.remove(business.id, selected, priceId)}
        columns={[{ label: "Tipo", value: (item) => item.pricingType }, { label: "Moneda", value: (item) => item.currency }, { label: "Precio fijo", value: (item) => cell.text(item.fixedPrice) }, { label: "Precio unitario", value: (item) => cell.text(item.unitPrice) }, { label: "Rango", value: (item) => `${cell.text(item.minQuantity)} – ${cell.text(item.maxQuantity)}` }, { label: "Estado", value: (item) => cell.status(item.status) }]}
        fields={[
          { name: "pricingType", label: "Tipo de precio", kind: "select", required: true, options: [{ value: "fixed", label: "Fijo" }, { value: "unit", label: "Por unidad" }] },
          { name: "currency", label: "Moneda de la tienda", kind: "select", required: true, options: [{ value: business.currency, label: business.currency }] },
          { name: "fixedPrice", label: "Precio fijo (unidad menor)", kind: "number", nullable: true },
          { name: "unitPrice", label: "Precio unitario (unidad menor)", kind: "number", nullable: true },
          { name: "minQuantity", label: "Cantidad mínima", kind: "number", nullable: true },
          { name: "maxQuantity", label: "Cantidad máxima", kind: "number", nullable: true },
          { name: "status", label: "Estado", kind: "select", editOnly: true, options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] },
        ]} />}
  </div>;
}
