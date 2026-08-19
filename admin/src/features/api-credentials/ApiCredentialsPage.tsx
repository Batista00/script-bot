import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { businessQueryKey } from "../../app/query-client";
import { Button, EmptyState, Field, Modal, PageHeader, Spinner, StatusBadge, useToast } from "../../components/ui";
import { errorMessage } from "../../lib/api/client";
import { credentialsApi } from "../../lib/api/resources";
import type { ApiCredential } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";

export function RawTokenDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return <Modal title="Credential creada" onClose={onClose}><div className="alert warning"><strong>Guarda este token ahora.</strong> No podrá volver a mostrarse.</div><div className="token-box" data-testid="raw-token">{token}</div><div className="form-actions"><Button className="secondary" onClick={async () => { await navigator.clipboard.writeText(token); setCopied(true); }}>{copied ? "Copiado" : "Copiar"}</Button><Button onClick={onClose}>Ya lo guardé</Button></div></Modal>;
}
export function ApiCredentialsPage() {
  const business = useBusiness(); const client = useQueryClient(); const toast = useToast(); const [creating, setCreating] = useState(false); const [token, setToken] = useState<string | null>(null);
  const query = useQuery({ queryKey: businessQueryKey("api-credentials", business.id), queryFn: () => credentialsApi.list(business.id, { limit: 100, offset: 0 }) });
  const create = useMutation({ mutationFn: (name: string) => credentialsApi.create(business.id, name), onSuccess: async (result) => { setCreating(false); setToken(result.token); await client.invalidateQueries({ queryKey: ["api-credentials", business.id] }); } });
  const update = useMutation({ mutationFn: ({ item, status }: { item: ApiCredential; status: "active" | "inactive" }) => credentialsApi.update(business.id, item.id, { status }), onSuccess: async () => { await client.invalidateQueries({ queryKey: ["api-credentials", business.id] }); toast("Credential actualizada."); } });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); create.mutate(String(new FormData(event.currentTarget).get("name"))); }
  return <><PageHeader title="API Credentials" description="Tokens para automatizaciones como Typebot; el panel nunca usa Machine Auth." action={business.role !== "operator" ? <Button onClick={() => setCreating(true)}>Crear credential</Button> : undefined} />{business.role === "operator" && <div className="alert">Las credenciales requieren rol owner o admin.</div>}
    {query.isLoading ? <Spinner /> : query.isError ? <div className="alert error">{errorMessage(query.error)}</div> : !query.data?.length ? <EmptyState title="No hay API credentials." /> : <div className="table-card"><div className="table-scroll"><table><thead><tr><th>Nombre</th><th>Prefijo</th><th>Estado</th><th>Creada</th><th /></tr></thead><tbody>{query.data.map((item) => <tr key={item.id}><td>{item.name}</td><td><code>{item.prefix}…</code></td><td><StatusBadge value={item.status} /></td><td>{new Date(item.createdAt).toLocaleString()}</td><td>{business.role !== "operator" && <Button className="secondary small" onClick={() => { const next = item.status === "active" ? "inactive" : "active"; if (next === "inactive" && !window.confirm("¿Desactivar esta API credential?")) return; update.mutate({ item, status: next }); }}>{item.status === "active" ? "Desactivar" : "Activar"}</Button>}</td></tr>)}</tbody></table></div></div>}
    {creating && <Modal title="Crear API credential" onClose={() => setCreating(false)}><form onSubmit={submit}><Field label="Nombre" name="name" required maxLength={120} />{create.isError && <div className="alert error">{errorMessage(create.error)}</div>}<div className="form-actions"><Button className="secondary" type="button" onClick={() => setCreating(false)}>Cancelar</Button><Button type="submit" disabled={create.isPending}>Crear</Button></div></form></Modal>}
    {token && <RawTokenDialog token={token} onClose={() => setToken(null)} />}
  </>;
}
