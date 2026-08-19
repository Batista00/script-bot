import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";

import { businessQueryKey } from "../../app/query-client";
import { Button, EmptyState, Field, Modal, PageHeader, Pagination, SelectField, Spinner, StatusBadge, TextAreaField, useToast } from "../../components/ui";
import { errorMessage } from "../../lib/api/client";
import type { Role } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";

export interface FormField {
  name: string; label: string; kind?: "text" | "email" | "number" | "textarea" | "select";
  required?: boolean; nullable?: boolean; options?: Array<{ value: string; label: string }>;
  editOnly?: boolean;
}
export interface Column<T> { label: string; value: (record: T) => ReactNode }

interface EntityPageProps<T extends { id: string; status?: string }> {
  resource: string; title: string; description: string; empty: string;
  scopeKey?: string;
  columns: Column<T>[]; fields: FormField[]; readOnly?: boolean;
  writeRoles?: readonly Role[];
  list: (businessId: string, query: Record<string, string | number>) => Promise<T[]>;
  create: (businessId: string, body: Record<string, unknown>) => Promise<T>;
  update: (businessId: string, id: string, body: Record<string, unknown>) => Promise<T>;
}

function formPayload(form: HTMLFormElement, fields: FormField[]): Record<string, unknown> {
  const data = new FormData(form); const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = String(data.get(field.name) ?? "").trim();
    if (raw === "" && field.nullable) payload[field.name] = null;
    else if (raw !== "") payload[field.name] = field.kind === "number" ? Number(raw) : raw;
  }
  return payload;
}

export function EntityPage<T extends { id: string; status?: string }>(props: EntityPageProps<T>) {
  const business = useBusiness(); const client = useQueryClient(); const toast = useToast();
  const [offset, setOffset] = useState(0); const [editing, setEditing] = useState<T | "new" | null>(null);
  const canWrite = (props.writeRoles ?? ["owner", "admin"]).includes(business.role);
  const key = businessQueryKey(props.resource, business.id, props.scopeKey ?? "all", { offset });
  const query = useQuery({ queryKey: key, queryFn: () => props.list(business.id, { limit: 25, offset }) });
  const mutation = useMutation({ mutationFn: async (payload: Record<string, unknown>) => editing === "new" ? props.create(business.id, payload) : props.update(business.id, (editing as T).id, payload), onSuccess: async () => { setEditing(null); await client.invalidateQueries({ queryKey: [props.resource, business.id] }); toast("Cambios guardados."); } });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const fields = props.fields.filter((field) => editing !== "new" || !field.editOnly); const payload = formPayload(event.currentTarget, fields); if (payload.status === "inactive" && editing !== "new" && !window.confirm("¿Confirmas la desactivación?")) return; mutation.mutate(payload); }
  return <><PageHeader title={props.title} description={props.description} action={canWrite && !props.readOnly ? <Button onClick={() => setEditing("new")}>Crear</Button> : undefined} />
    {query.isLoading ? <Spinner /> : query.isError ? <div className="alert error">{errorMessage(query.error)}</div> : !query.data?.length ? <EmptyState title={props.empty} action={canWrite && !props.readOnly ? <Button onClick={() => setEditing("new")}>Crear</Button> : undefined} /> : <div className="table-card"><div className="table-scroll"><table><thead><tr>{props.columns.map((column) => <th key={column.label}>{column.label}</th>)}{canWrite && !props.readOnly && <th>Acciones</th>}</tr></thead><tbody>{query.data.map((record) => <tr key={record.id}>{props.columns.map((column) => <td key={column.label}>{column.value(record)}</td>)}{canWrite && !props.readOnly && <td><Button className="secondary small" onClick={() => setEditing(record)}>Editar</Button></td>}</tr>)}</tbody></table></div><Pagination offset={offset} limit={25} count={query.data.length} onChange={setOffset} /></div>}
    {editing && <Modal title={editing === "new" ? `Crear ${props.title.toLowerCase()}` : `Editar ${props.title.toLowerCase()}`} onClose={() => setEditing(null)}><form onSubmit={submit}>{props.fields.filter((field) => editing !== "new" || !field.editOnly).map((field) => {
      const value = editing === "new" ? "" : String((editing as Record<string, unknown>)[field.name] ?? "");
      if (field.kind === "textarea") return <TextAreaField key={field.name} label={field.label} name={field.name} defaultValue={value} required={field.required} />;
      if (field.kind === "select") return <SelectField key={field.name} label={field.label} name={field.name} defaultValue={value} required={field.required}>{field.nullable && <option value="">Sin asignar</option>}{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</SelectField>;
      return <Field key={field.name} label={field.label} name={field.name} type={field.kind ?? "text"} defaultValue={value} required={field.required} />;
    })}{mutation.isError && <div className="alert error">{errorMessage(mutation.error)}</div>}<div className="form-actions"><Button className="secondary" type="button" onClick={() => setEditing(null)}>Cancelar</Button><Button type="submit" disabled={mutation.isPending}>Guardar</Button></div></form></Modal>}
  </>;
}

export const cell = {
  text: (value: unknown) => String(value ?? "—"),
  status: (value: string) => <StatusBadge value={value} />,
};
