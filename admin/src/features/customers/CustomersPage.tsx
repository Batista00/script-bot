import { customersApi } from "../../lib/api/resources";
import type { Customer } from "../../lib/api/types";
import { cell, EntityPage } from "../shared/EntityPage";

export function CustomersPage() {
  return <EntityPage<Customer>
    resource="customers" title="Clientes" description="Contactos comerciales del negocio actual."
    empty="No hay clientes." writeRoles={["owner", "admin", "operator"]}
    list={customersApi.list} create={customersApi.create} update={customersApi.update}
    columns={[
      { label: "Nombre", value: (item) => cell.text(item.name) },
      { label: "Teléfono", value: (item) => cell.text(item.phone) },
      { label: "Email", value: (item) => cell.text(item.email) },
      { label: "Estado", value: (item) => cell.status(item.status) },
    ]}
    fields={[
      { name: "name", label: "Nombre", nullable: true },
      { name: "phone", label: "Teléfono", nullable: true },
      { name: "email", label: "Email", kind: "email", nullable: true },
      { name: "status", label: "Estado", kind: "select", editOnly: true, options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] },
    ]}
  />;
}
