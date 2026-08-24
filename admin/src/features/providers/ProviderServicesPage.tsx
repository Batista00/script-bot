import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { businessQueryKey } from "../../app/query-client";
import {
  Button, EmptyState, Field, Modal, PageHeader, Pagination, SelectField,
  Spinner, StatusBadge, TextAreaField, useToast,
} from "../../components/ui";
import { errorMessage } from "../../lib/api/client";
import { categoriesApi, integrationsApi, providerApi } from "../../lib/api/resources";
import type {
  ImportProviderProductInput, ProductInputField, ProviderOrderField, ProviderService,
} from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";

function optionalString(data: FormData, name: string): string | null {
  const value = String(data.get(name) ?? "").trim();
  return value === "" ? null : value;
}

function optionalNumber(data: FormData, name: string): number | null {
  const value = String(data.get(name) ?? "").trim();
  return value === "" ? null : Number(value);
}

function providerDescription(service: ProviderService): string {
  return service.providerDescription ??
    (typeof service.metadata.description === "string" ? service.metadata.description : "");
}

const inputCopy: Record<string, { label: string; helpText: string | null }> = {
  targetUrl: { label: "Enlace de destino", helpText: "Ingresa el enlace de la publicación, perfil o recurso." },
  comments: { label: "Comentarios", helpText: "Escribe un comentario por línea." },
  username: { label: "Nombre de usuario", helpText: "No ingreses contraseña." },
  minimum: { label: "Cantidad mínima por publicación", helpText: null },
  maximum: { label: "Cantidad máxima por publicación", helpText: null },
  posts: { label: "Cantidad de publicaciones", helpText: null },
  delay: { label: "Demora", helpText: "Valor requerido por el proveedor." },
  expiry: { label: "Fecha de expiración", helpText: null },
  runs: { label: "Número de ejecuciones", helpText: null },
  interval: { label: "Intervalo en minutos", helpText: null },
};

export function commercialInputsFromProvider(fields: ProviderOrderField[]): ProductInputField[] {
  return fields.map((field, position) => ({
    key: field.key,
    label: inputCopy[field.key]?.label ?? field.key,
    helpText: inputCopy[field.key]?.helpText ?? null,
    type: field.type,
    required: true,
    position,
    validation: field.type === "integer" ? { minimum: 0 } : { maxLength: 10_000 },
  }));
}

export function providerImportValidationMessage(
  input: ImportProviderProductInput,
): string | null {
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    return "La moneda retail está vacía o no es válida. Configura la moneda global del negocio e intenta nuevamente.";
  }
  if (!Number.isSafeInteger(input.retailPrice) || input.retailPrice <= 0) {
    return "El precio retail debe ser un número entero mayor que cero.";
  }
  for (const [label, value] of [
    ["mínima", input.minQuantity],
    ["máxima", input.maxQuantity],
  ] as const) {
    if (value !== null && (!Number.isInteger(value) || value <= 0 || value > 2_147_483_647)) {
      return `La cantidad ${label} debe ser un número entero entre 1 y 2147483647.`;
    }
  }
  if (
    input.minQuantity !== null && input.maxQuantity !== null &&
    input.maxQuantity < input.minQuantity
  ) {
    return "La cantidad máxima debe ser igual o mayor que la cantidad mínima.";
  }
  return null;
}

export function providerImportPayload(
  providerServiceId: string,
  data: FormData,
  requiredInputs?: ProductInputField[],
): ImportProviderProductInput {
  return {
    providerServiceId,
    name: String(data.get("name") ?? "").trim(),
    description: optionalString(data, "description"),
    categoryId: optionalString(data, "categoryId"),
    sku: optionalString(data, "sku"),
    type: String(data.get("type")) as ImportProviderProductInput["type"],
    minQuantity: optionalNumber(data, "minQuantity"),
    maxQuantity: optionalNumber(data, "maxQuantity"),
    currency: String(data.get("currency") ?? "").trim().toUpperCase(),
    pricingType: String(data.get("pricingType")) as ImportProviderProductInput["pricingType"],
    retailPrice: Number(data.get("retailPrice")),
    status: String(data.get("status")) as ImportProviderProductInput["status"],
    ...(requiredInputs === undefined ? {} : { requiredInputs }),
  };
}

export function ProviderServicesPage() {
  const business = useBusiness();
  const client = useQueryClient();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [providerStatus, setProviderStatus] = useState("");
  const [integrationId, setIntegrationId] = useState("");
  const [externalServiceId, setExternalServiceId] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [mappingStatus, setMappingStatus] = useState("");
  const [selected, setSelected] = useState<ProviderService | null>(null);
  const [requiredInputs, setRequiredInputs] = useState<ProductInputField[]>([]);
  const [importValidationError, setImportValidationError] = useState<string | null>(null);
  const integrations = useQuery({
    queryKey: businessQueryKey("integrations", business.id, "provider-options"),
    queryFn: () => integrationsApi.list(business.id, { limit: 100, offset: 0 }),
  });
  const categories = useQuery({
    queryKey: businessQueryKey("categories", business.id, "provider-import-options"),
    queryFn: () => categoriesApi.list(business.id, { limit: 100, offset: 0, status: "active" }),
  });
  const services = useQuery({
    queryKey: businessQueryKey("provider-services", business.id, {
      offset, providerStatus, integrationId, externalServiceId, search, category,
      serviceType, mappingStatus,
    }),
    queryFn: () => providerApi.list(business.id, {
      limit: 25, offset, providerStatus, integrationId,
      externalServiceId: externalServiceId.trim() || undefined,
      search: search.trim() || undefined, category: category.trim() || undefined,
      serviceType: serviceType.trim() || undefined,
      mappingStatus: mappingStatus || undefined,
    }),
  });
  const providerState = useQuery({
    queryKey: businessQueryKey("provider-catalog-state", business.id, integrationId),
    queryFn: () => providerApi.state(business.id, integrationId),
    enabled: integrationId !== "",
  });
  const sync = useMutation({
    mutationFn: () => providerApi.sync(business.id, integrationId),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ["provider-services", business.id] });
      await client.invalidateQueries({ queryKey: ["provider-catalog-state", business.id] });
      toast(`Sync: ${result.received} recibidos, ${result.normalized} normalizados, ${result.rejected} rechazados.`);
    },
  });
  const importProduct = useMutation({
    mutationFn: (payload: ImportProviderProductInput) => providerApi.importProduct(business.id, payload),
    onSuccess: async () => {
      setSelected(null);
      setImportValidationError(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["products", business.id] }),
        client.invalidateQueries({ queryKey: ["pricing", business.id] }),
        client.invalidateQueries({ queryKey: ["mapping", business.id] }),
        client.invalidateQueries({ queryKey: ["provider-services", business.id] }),
      ]);
      toast("Servicio importado a Catálogo → Productos. Ya puedes configurarlo allí.");
    },
  });
  function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const payload = providerImportPayload(
      selected.id,
      new FormData(event.currentTarget),
      requiredInputs,
    );
    const validationError = providerImportValidationMessage(payload);
    if (validationError) {
      setImportValidationError(validationError);
      return;
    }
    setImportValidationError(null);
    importProduct.mutate(payload);
  }
  const canWrite = business.role !== "operator";

  return <>
    <PageHeader
      title="Servicios de proveedor"
      description="Catálogo técnico separado de Products y retail pricing."
      action={<><Button className="secondary" onClick={() => {
        void client.invalidateQueries({ queryKey: ["provider-services", business.id] });
        void client.invalidateQueries({ queryKey: ["provider-catalog-state", business.id] });
      }}>Refrescar</Button>{canWrite && <Button disabled={!integrationId || sync.isPending}
        onClick={() => sync.mutate()}>Sincronizar servicios</Button>}</>}
    />
    {integrationId && providerState.data && <div className="filter-bar">
      <div><strong>Conexión</strong><div>{providerState.data.connectionStatus === "ok" ? "OK" : providerState.data.connectionStatus}</div></div>
      <div><strong>Saldo proveedor</strong><div>{providerState.data.providerBalance ?? "—"} {providerState.data.providerCurrency ?? ""}</div></div>
      <div><strong>Última sync</strong><div>{providerState.data.lastSyncAt ? new Date(providerState.data.lastSyncAt).toLocaleString() : "—"}</div></div>
      <div><strong>Servicios</strong><div>{providerState.data.servicesNormalized} · rechazados {providerState.data.servicesRejected}</div></div>
    </div>}
    <div className="filter-bar">
      <SelectField label="Integración" value={integrationId} onChange={(event) => {
        setIntegrationId(event.target.value); setOffset(0);
      }}>
        <option value="">Todas</option>
        {integrations.data?.map((item) => <option key={item.id} value={item.id}>{item.providerKey}</option>)}
      </SelectField>
      <SelectField label="Estado proveedor" value={providerStatus} onChange={(event) => {
        setProviderStatus(event.target.value); setOffset(0);
      }}>
        <option value="">Todos</option><option value="active">Activo</option>
        <option value="inactive">Inactivo</option>
      </SelectField>
      <Field label="Buscar por ID de servicio" value={externalServiceId}
        placeholder="Ejemplo: 12345" onChange={(event) => {
          setExternalServiceId(event.target.value.trim()); setOffset(0);
        }} />
      <Field label="Búsqueda rápida" value={search} placeholder="ID, nombre o categoría"
        onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />
      <Field label="Categoría exacta" value={category}
        onChange={(event) => { setCategory(event.target.value); setOffset(0); }} />
      <Field label="Tipo exacto" value={serviceType}
        onChange={(event) => { setServiceType(event.target.value); setOffset(0); }} />
      <SelectField label="Importación" value={mappingStatus} onChange={(event) => {
        setMappingStatus(event.target.value); setOffset(0);
      }}><option value="">Todos</option><option value="mapped">Importados</option>
        <option value="unmapped">No importados</option></SelectField>
    </div>
    {sync.isError && <div className="alert error">{errorMessage(sync.error)}</div>}
    {services.isLoading ? <Spinner /> : services.isError
      ? <div className="alert error">{errorMessage(services.error)}</div>
      : !services.data?.length ? <EmptyState title="No hay servicios sincronizados." />
      : <div className="table-card"><div className="table-scroll"><table>
          <thead><tr><th>Proveedor</th><th>ID externo</th><th>Nombre</th><th>Categoría / tipo</th>
            <th>Rate</th><th>Min / max</th><th>Estado</th><th>Products</th><th>Último sync</th>
            {canWrite && <th>Acciones</th>}</tr></thead>
          <tbody>{services.data.map((item) => <tr key={item.id}>
            <td>{item.providerKey}</td><td><code>{item.externalServiceId}</code></td>
            <td>{item.name}</td><td>{item.category || "—"} / {item.serviceType || "—"}</td>
            <td>{item.rate ?? "—"} {item.rateCurrency ?? ""}</td>
            <td>{item.minQuantity ?? "—"} / {item.maxQuantity ?? "—"}</td>
            <td><StatusBadge value={item.providerStatus} /></td>
            <td>{item.mappingCount}</td>
            <td>{new Date(item.lastSyncedAt).toLocaleString()}</td>
            {canWrite && <td><Button className="secondary small" disabled={item.providerStatus !== "active"}
              onClick={() => {
                setImportValidationError(null);
                setRequiredInputs(commercialInputsFromProvider(item.orderCapabilities.required));
                setSelected(item);
              }}>Importar</Button></td>}
          </tr>)}</tbody>
        </table></div><Pagination offset={offset} limit={25} count={services.data.length} onChange={setOffset} /></div>}

    {selected && <Modal title="Importar a Catálogo → Productos" onClose={() => {
      setImportValidationError(null); setSelected(null);
    }}>
      <div className="alert">
        Referencia proveedor: <strong>{selected.name}</strong> · ID {selected.externalServiceId}
        · rate {selected.rate ?? "no informado"} · límites {selected.minQuantity ?? "—"}–{selected.maxQuantity ?? "—"}.
      </div>
      {!selected.orderCapabilities.supported && <div className="alert error">
        El tipo técnico <strong>{selected.serviceType ?? "desconocido"}</strong> no tiene un contrato de pedido oficial verificado. Puedes importarlo inactivo, pero no despacharlo todavía.
      </div>}
      <form onSubmit={submitImport}>
        <Field label="Nombre comercial" name="name" defaultValue={selected.name} required />
        <TextAreaField label="Descripción" name="description"
          defaultValue={providerDescription(selected)} />
        <SelectField label="Categoría" name="categoryId" defaultValue="">
          <option value="">Sin asignar</option>
          {categories.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </SelectField>
        <Field label="SKU" name="sku" />
        <SelectField label="Tipo de producto" name="type" defaultValue="service" required>
          <option value="service">Servicio</option><option value="product">Producto</option>
        </SelectField>
        <Field label="Cantidad mínima" name="minQuantity" type="number" min="1"
          defaultValue={selected.minQuantity ?? ""} />
        <Field label="Cantidad máxima" name="maxQuantity" type="number" min="1"
          defaultValue={selected.maxQuantity ?? ""} />
        <Field label="Moneda retail" name="currency"
          defaultValue={business.currency?.trim().toUpperCase() ?? ""} readOnly required />
        <SelectField label="Modelo de precio" name="pricingType"
          defaultValue={selected.serviceType?.toLowerCase().includes("package") ? "fixed" : "unit"} required>
          <option value="unit">Por unidad</option><option value="fixed">Fijo</option>
        </SelectField>
        <Field label="Precio retail (entero en unidad mínima)" name="retailPrice" type="number" min="1" required />
        <SelectField label="Estado inicial" name="status" defaultValue="active" required>
          <option value="active">Activo</option><option value="inactive">Inactivo</option>
        </SelectField>
        <h3>Datos que entregará el cliente</h3>
        {requiredInputs.length === 0 ? <div className="alert">Este tipo no tiene campos comerciales verificados.</div>
          : requiredInputs.map((input, index) => <div className="filter-bar" key={input.key}>
            <Field label={`Etiqueta · ${input.key}`} value={input.label} onChange={(event) => {
              setRequiredInputs((items) => items.map((item, itemIndex) =>
                itemIndex === index ? { ...item, label: event.target.value } : item));
            }} />
            <Field label="Ayuda" value={input.helpText ?? ""} onChange={(event) => {
              setRequiredInputs((items) => items.map((item, itemIndex) =>
                itemIndex === index ? { ...item, helpText: event.target.value || null } : item));
            }} />
            <div><strong>Validación</strong><div>{input.type} · obligatorio</div></div>
            <div className="form-actions">
              <Button className="secondary small" type="button" disabled={index === 0}
                onClick={() => setRequiredInputs((items) => {
                  const copy = [...items];
                  const previous = copy[index - 1];
                  if (!previous) return items;
                  copy[index - 1] = { ...input, position: index - 1 };
                  copy[index] = { ...previous, position: index };
                  return copy;
                })}>Subir</Button>
            </div>
          </div>)}
        {importValidationError && <div className="alert error">{importValidationError}</div>}
        {importProduct.isError && <div className="alert error">{errorMessage(importProduct.error)}</div>}
        <div className="form-actions">
          <Button className="secondary" type="button" onClick={() => {
            setImportValidationError(null); setSelected(null);
          }}>Cancelar</Button>
          <Button type="submit" disabled={importProduct.isPending}>Importar</Button>
        </div>
      </form>
    </Modal>}
  </>;
}
