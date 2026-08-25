import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { businessQueryKey } from "../../app/query-client";
import { Button, EmptyState, Field, Modal, PageHeader, SelectField, Spinner, StatusBadge, useToast } from "../../components/ui";
import { errorMessage } from "../../lib/api/client";
import { paymentMethodsApi } from "../../lib/api/resources";
import type { PaymentMethod } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";

function configFromForm(type: PaymentMethod["type"], data: FormData) {
  if (type === "mercado_pago") return {};
  const email = String(data.get("email") ?? "").trim();
  return {
    accountHolder: String(data.get("accountHolder") ?? "").trim(),
    rut: String(data.get("rut") ?? "").trim(), bankName: String(data.get("bankName") ?? "").trim(),
    accountType: String(data.get("accountType") ?? ""), accountNumber: String(data.get("accountNumber") ?? "").trim(),
    ...(email ? { email } : {}),
  };
}

export function PaymentMethodsPage() {
  const business = useBusiness(); const client = useQueryClient(); const toast = useToast();
  const [creating, setCreating] = useState(false); const [type, setType] = useState<PaymentMethod["type"]>("bank_transfer");
  const methods = useQuery({ queryKey: businessQueryKey("payment-methods", business.id), queryFn: () => paymentMethodsApi.list(business.id) });
  const create = useMutation({ mutationFn: (body: unknown) => paymentMethodsApi.create(business.id, body), onSuccess: async () => { setCreating(false); await client.invalidateQueries({ queryKey: ["payment-methods", business.id] }); toast("Método de pago creado."); } });
  const update = useMutation({ mutationFn: ({ id, status }: { id: string; status: "active" | "inactive" }) => paymentMethodsApi.update(business.id, id, { status }), onSuccess: async () => client.invalidateQueries({ queryKey: ["payment-methods", business.id] }) });
  const remove = useMutation({ mutationFn: (id: string) => paymentMethodsApi.remove(business.id, id), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["payment-methods", business.id] }); toast("Método eliminado."); } });
  const canWrite = business.role !== "operator";
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); create.mutate({ type, name: String(data.get("name") ?? "").trim(), config: configFromForm(type, data) }); }
  function deleteMethod(method: PaymentMethod) { if (window.confirm(`¿Eliminar ${method.name}? Si tiene pagos históricos, deberás desactivarlo.`)) remove.mutate(method.id); }
  return <><PageHeader title="Métodos de pago" description="Opciones que el bot puede ofrecer al cliente. La transferencia bancaria requiere confirmación humana." action={canWrite ? <Button onClick={() => setCreating(true)}>Agregar método</Button> : undefined} />
    {methods.isLoading ? <Spinner /> : methods.isError ? <div className="alert error">{errorMessage(methods.error)}</div> : !methods.data?.length ? <EmptyState title="No hay métodos de pago configurados." /> : <div className="table-card"><div className="table-scroll"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Datos</th><th>Estado</th>{canWrite && <th>Acciones</th>}</tr></thead><tbody>{methods.data.map((method) => <tr key={method.id}><td>{method.name}</td><td>{method.type === "bank_transfer" ? "Transferencia bancaria" : "Mercado Pago"}</td><td>{method.type === "bank_transfer" ? `${String(method.config.bankName ?? "")} · ${String(method.config.accountNumber ?? "")}` : "Credenciales desde Integraciones"}</td><td><StatusBadge value={method.status} /></td>{canWrite && <td><div className="table-actions"><Button className="secondary small" onClick={() => update.mutate({ id: method.id, status: method.status === "active" ? "inactive" : "active" })}>{method.status === "active" ? "Desactivar" : "Activar"}</Button><Button className="danger small" onClick={() => deleteMethod(method)}>Eliminar</Button></div></td>}</tr>)}</tbody></table></div></div>}
    {(create.isError || update.isError || remove.isError) && <div className="alert error">{errorMessage(create.error ?? update.error ?? remove.error)}</div>}
    {creating && <Modal title="Agregar método de pago" onClose={() => setCreating(false)}><form onSubmit={submit}><Field label="Nombre visible al cliente" name="name" required maxLength={120} /><SelectField label="Tipo" name="type" value={type} onChange={(event) => setType(event.target.value as PaymentMethod["type"])}><option value="bank_transfer">Transferencia bancaria Chile</option><option value="mercado_pago">Mercado Pago</option></SelectField>{type === "bank_transfer" && <><Field label="Titular" name="accountHolder" required /><Field label="RUT (sin puntos, con guion)" name="rut" placeholder="12345678-9" required /><Field label="Banco" name="bankName" required /><SelectField label="Tipo de cuenta" name="accountType" required><option value="checking">Cuenta corriente</option><option value="sight">Cuenta vista / RUT</option><option value="savings">Cuenta de ahorro</option></SelectField><Field label="Número de cuenta" name="accountNumber" required /><Field label="Correo (opcional)" name="email" type="email" /></>}<div className="form-actions"><Button className="secondary" type="button" onClick={() => setCreating(false)}>Cancelar</Button><Button type="submit" disabled={create.isPending}>Guardar</Button></div></form></Modal>}
  </>;
}
