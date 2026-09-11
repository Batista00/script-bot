import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { businessQueryKey } from "../../app/query-client";
import {
  Button, EmptyState, Field, PageHeader, Pagination, SelectField,
  Spinner, StatusBadge, useToast,
} from "../../components/ui";
import { errorMessage } from "../../lib/api/client";
import { jobsApi } from "../../lib/api/resources";
import { JOB_STATUSES, type JobStatus } from "../../lib/api/types";
import { useBusiness } from "../businesses/business-context";

export const PAGE_SIZE = 25;

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending: "Pendiente",
  running: "En ejecución",
  completed: "Completado",
  failed: "Fallido",
  cancelled: "Cancelado",
};

export function truncateError(value: string | null, maxLength = 80): string {
  if (!value) return "—";
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

export function JobsPage() {
  const business = useBusiness(); const client = useQueryClient(); const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<JobStatus | "">("failed");
  const [jobType, setJobType] = useState("");
  const canRetry = business.role === "owner" || business.role === "admin";
  const query = useQuery({
    queryKey: businessQueryKey("jobs", business.id, { offset, status, jobType }),
    queryFn: () => jobsApi.list(business.id, {
      limit: PAGE_SIZE, offset,
      status: status || undefined,
      jobType: jobType.trim() || undefined,
    }),
  });
  const retry = useMutation({
    mutationFn: (jobId: string) => jobsApi.retry(business.id, jobId),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["jobs", business.id] });
      toast("Job reintentado. El worker lo ejecutará según su programación.");
    },
  });
  return <>
    <PageHeader title="Jobs" description="Cola persistida de trabajos en segundo plano. Reintenta los que quedaron fallidos." />
    <div className="filter-bar">
      <SelectField label="Estado" value={status} onChange={(event) => {
        setStatus(event.target.value as JobStatus | ""); setOffset(0);
      }}>
        <option value="">Todos</option>
        {JOB_STATUSES.map((value) => <option key={value} value={value}>{JOB_STATUS_LABELS[value]}</option>)}
      </SelectField>
      <Field label="Tipo de job" value={jobType} placeholder="Ejemplo: fulfillment_dispatch"
        onChange={(event) => { setJobType(event.target.value); setOffset(0); }} />
    </div>
    {retry.isError && <div className="alert error">{errorMessage(retry.error)}</div>}
    {query.isLoading ? <Spinner /> : query.isError
      ? <div className="alert error">{errorMessage(query.error)}</div>
      : !query.data?.length ? <EmptyState title="No hay jobs con estos filtros." />
      : <div className="table-card"><div className="table-scroll"><table>
          <thead><tr><th>Tipo</th><th>Estado</th><th>Intentos</th><th>Programado</th>
            <th>Último error</th>{canRetry && <th>Acciones</th>}</tr></thead>
          <tbody>{query.data.map((job) => <tr key={job.jobId}>
            <td>{job.jobType}</td>
            <td><StatusBadge value={job.status} /></td>
            <td>{job.attempts}/{job.maxAttempts}</td>
            <td>{new Date(job.runAt).toLocaleString()}</td>
            <td title={job.lastError ?? undefined}>{truncateError(job.lastError)}</td>
            {canRetry && <td><Button className="secondary small" disabled={retry.isPending}
              onClick={() => retry.mutate(job.jobId)}>Reintentar</Button></td>}
          </tr>)}</tbody>
        </table></div><Pagination offset={offset} limit={PAGE_SIZE} count={query.data.length} onChange={setOffset} /></div>}
  </>;
}
