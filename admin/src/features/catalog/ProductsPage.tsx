import { useQuery } from "@tanstack/react-query";
import { businessQueryKey } from "../../app/query-client";
import { Spinner } from "../../components/ui";
import { categoriesApi, productsApi } from "../../lib/api/resources";
import type { Product } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";
import { cell, EntityPage } from "../shared/EntityPage";

export function ProductsPage() {
  const business = useBusiness();
  const categories = useQuery({ queryKey: businessQueryKey("categories", business.id, "options"), queryFn: () => categoriesApi.list(business.id, { limit: 100, offset: 0, status: "active" }) });
  if (categories.isLoading) return <Spinner />;
  return <EntityPage<Product> resource="products" title="Productos" description="Oferta comercial propia; los datos del proveedor viven por separado." empty="No hay productos."
    list={productsApi.list} create={productsApi.create} update={productsApi.update}
    columns={[
      { label: "Nombre", value: (item) => item.name }, { label: "Tipo", value: (item) => item.type },
      { label: "SKU", value: (item) => cell.text(item.sku) },
      { label: "Cantidad", value: (item) => `${cell.text(item.minQuantity)} – ${cell.text(item.maxQuantity)}` },
      { label: "Estado", value: (item) => cell.status(item.status) },
    ]}
    fields={[
      { name: "name", label: "Nombre", required: true },
      { name: "description", label: "Descripción", kind: "textarea", nullable: true },
      { name: "type", label: "Tipo", kind: "select", required: true, options: [{ value: "service", label: "Servicio" }, { value: "product", label: "Producto" }] },
      { name: "sku", label: "SKU", nullable: true },
      { name: "categoryId", label: "Categoría", kind: "select", nullable: true, options: categories.data?.map((item) => ({ value: item.id, label: item.name })) },
      { name: "minQuantity", label: "Cantidad mínima", kind: "number", nullable: true },
      { name: "maxQuantity", label: "Cantidad máxima", kind: "number", nullable: true },
      { name: "status", label: "Estado", kind: "select", editOnly: true, options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] },
    ]}
  />;
}
