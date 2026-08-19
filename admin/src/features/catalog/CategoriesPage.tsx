import { categoriesApi } from "../../lib/api/resources";
import type { Category } from "../../lib/api/types";
import { cell, EntityPage } from "../shared/EntityPage";

export function CategoriesPage() {
  return <EntityPage<Category> resource="categories" title="Categorías"
    description="Organización del catálogo comercial." empty="No hay categorías."
    list={categoriesApi.list} create={categoriesApi.create} update={categoriesApi.update}
    columns={[{ label: "Nombre", value: (item) => item.name }, { label: "Estado", value: (item) => cell.status(item.status) }, { label: "Actualizada", value: (item) => new Date(item.updatedAt).toLocaleString() }]}
    fields={[{ name: "name", label: "Nombre", required: true }, { name: "status", label: "Estado", kind: "select", editOnly: true, options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] }]}
  />;
}
