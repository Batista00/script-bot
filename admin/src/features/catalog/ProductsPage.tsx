import { useQuery } from "@tanstack/react-query";
import { businessQueryKey } from "../../app/query-client";
import { Spinner } from "../../components/ui";
import { categoriesApi, productsApi } from "../../lib/api/resources";
import type { Product, ProductDelivery } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";
import { cell, EntityPage } from "../shared/EntityPage";
import { productPayload } from "./product-delivery-form";
import { ProductDeliveryFields } from "./ProductDeliveryFields";
import { ProductProviderMapping } from "../providers/ProductProviderMapping";
import { ProductDigitalAssets } from "./ProductDigitalAssets";

export function ProductsPage() {
  const business = useBusiness();
  const categories = useQuery({ queryKey: businessQueryKey("categories", business.id, "options"), queryFn: () => categoriesApi.list(business.id, { limit: 100, offset: 0, status: "active" }) });
  if (categories.isLoading) return <Spinner />;
  return <EntityPage<Product> resource="products" title="Productos" description="Configure qué vende y cómo lo entrega. La asociación con un proveedor se mantiene separada del tipo de producto." empty="No hay productos."
    list={productsApi.list}
    searchable editExtra={product=><><ProductProviderMapping product={product} /><ProductDigitalAssets product={product} /></>}
    create={async (id, body) => productsApi.create(id, productPayload(body))}
    update={async (id, productId, body) => productsApi.update(id, productId, productPayload(body))} remove={productsApi.remove}
    columns={[
      { label: "Nombre", value: (item) => item.name }, { label: "Tipo", value: (item) => item.type },
      { label: "SKU", value: (item) => cell.text(item.sku) },
      { label: "Entrega", value: (item) => item.deliveryConfig ? item.deliveryConfig.methods.map(m => ({service:"Servicio",digital:"Digital",shipping:"Domicilio",pickup:"Retiro en tienda"}[m])).join(" / ") : "Configuración existente" },
      { label: "Cantidad", value: (item) => `${cell.text(item.minQuantity)} – ${cell.text(item.maxQuantity)}` },
      { label: "Estado", value: (item) => cell.status(item.status) },
    ]}
    fields={[
      { name: "name", label: "Nombre", required: true },
      { name: "description", label: "Descripción", kind: "textarea", nullable: true },
      { name: "type", label: "Tipo", kind: "select", required: true, options: [{ value: "service", label: "Servicio" }, { value: "product", label: "Producto" }] },
      { name: "sku", label: "SKU", nullable: true },
      {name:"deliveryConfig",label:"Producto y entrega",kind:"json",render:value=><ProductDeliveryFields value={(value||null) as ProductDelivery|null} />},
      { name: "categoryId", label: "Categoría", kind: "select", nullable: true, options: categories.data?.map((item) => ({ value: item.id, label: item.name })) },
      { name: "minQuantity", label: "Cantidad mínima", kind: "number", nullable: true },
      { name: "maxQuantity", label: "Cantidad máxima", kind: "number", nullable: true },
      { name: "requiredInputs", label: "Campos del cliente (JSON avanzado)", kind: "json" },
      { name: "status", label: "Estado", kind: "select", editOnly: true, options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] },
    ]}
  />;
}
