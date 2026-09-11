import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import type { JsonObject } from "../integrations/integrations.types.js";
import type {
  EnqueueJobInput,
  Job,
  JobListOptions,
  JobsRepository,
  JobStatus,
} from "./jobs.types.js";

interface JobRow extends QueryResultRow {
  id: string;
  job_type: string;
  job_key: string;
  payload: JsonObject;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_at: Date | string;
  locked_at: Date | string | null;
  locked_by: string | null;
  last_error: string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const jobColumns = `id, job_type, job_key, payload, status, priority, attempts,
  max_attempts, run_at, locked_at, locked_by, last_error, completed_at,
  created_at, updated_at`;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    jobType: row.job_type,
    jobKey: row.job_key,
    payload: row.payload,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAt: toIso(row.run_at),
    lockedAt: nullableIso(row.locked_at),
    lockedBy: row.locked_by,
    lastError: row.last_error,
    completedAt: nullableIso(row.completed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class PostgresJobsRepository implements JobsRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async enqueue(input: EnqueueJobInput, executor = this.db): Promise<Job | null> {
    const result = await executor.query<JobRow>(
      `INSERT INTO job_queue (job_type, job_key, payload, priority, max_attempts, run_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, COALESCE($6::timestamptz, now()))
       ON CONFLICT (job_type, job_key) DO UPDATE
         SET status = 'pending',
             run_at = now(),
             attempts = 0,
             locked_at = NULL,
             locked_by = NULL,
             completed_at = NULL,
             last_error = NULL,
             payload = EXCLUDED.payload,
             priority = EXCLUDED.priority,
             max_attempts = EXCLUDED.max_attempts,
             updated_at = now()
         WHERE job_queue.status = 'failed' AND $7::boolean
       RETURNING ${jobColumns}`,
      [
        input.jobType,
        input.jobKey,
        JSON.stringify(input.payload ?? {}),
        input.priority ?? 0,
        input.maxAttempts ?? 5,
        input.runAt?.toISOString() ?? null,
        input.reopenFailed ?? false,
      ],
    );
    const row = result.rows[0];
    return row ? mapJob(row) : null;
  }

  async claim(workerId: string, limit: number, executor = this.db): Promise<Job[]> {
    const result = await executor.query<JobRow>(
      `UPDATE job_queue
       SET status = 'running',
           locked_at = now(),
           locked_by = $1,
           attempts = attempts + 1,
           updated_at = now()
       WHERE id IN (
         SELECT id FROM job_queue
         WHERE status = 'pending' AND run_at <= now()
         ORDER BY priority DESC, run_at ASC, created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING ${jobColumns}`,
      [workerId, limit],
    );
    return result.rows.map(mapJob);
  }

  async complete(jobId: string, workerId: string, executor = this.db): Promise<boolean> {
    const result = await executor.query(
      `UPDATE job_queue
       SET status = 'completed', completed_at = now(), locked_at = NULL, locked_by = NULL,
           last_error = NULL, updated_at = now()
       WHERE id = $1 AND status = 'running' AND locked_by = $2`,
      [jobId, workerId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async reschedule(
    jobId: string,
    workerId: string,
    runAt: Date,
    error: string | null,
    executor = this.db,
  ): Promise<boolean> {
    const result = await executor.query(
      `UPDATE job_queue
       SET status = 'pending', run_at = $3, locked_at = NULL, locked_by = NULL,
           last_error = $4, updated_at = now()
       WHERE id = $1 AND status = 'running' AND locked_by = $2`,
      [jobId, workerId, runAt.toISOString(), error],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async fail(
    jobId: string,
    workerId: string,
    error: string,
    executor = this.db,
  ): Promise<boolean> {
    const result = await executor.query(
      `UPDATE job_queue
       SET status = 'failed', locked_at = NULL, locked_by = NULL,
           last_error = $3, updated_at = now()
       WHERE id = $1 AND status = 'running' AND locked_by = $2`,
      [jobId, workerId, error],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async releaseStalled(leaseSeconds: number, executor = this.db): Promise<number> {
    const requeued = await executor.query(
      `UPDATE job_queue
       SET status = 'pending', locked_at = NULL, locked_by = NULL, run_at = now(),
           last_error = COALESCE(last_error, 'Worker lease expired'),
           updated_at = now()
       WHERE status = 'running'
         AND locked_at < now() - make_interval(secs => $1)
         AND attempts < max_attempts`,
      [leaseSeconds],
    );
    const exhausted = await executor.query(
      `UPDATE job_queue
       SET status = 'failed', locked_at = NULL, locked_by = NULL,
           last_error = COALESCE(last_error, 'Worker lease expired'),
           updated_at = now()
       WHERE status = 'running'
         AND locked_at < now() - make_interval(secs => $1)
         AND attempts >= max_attempts`,
      [leaseSeconds],
    );
    return (requeued.rowCount ?? 0) + (exhausted.rowCount ?? 0);
  }

  async list(options: JobListOptions): Promise<Job[]> {
    const result = await this.db.query<JobRow>(
      `SELECT ${jobColumns} FROM job_queue
       WHERE ($1::job_status IS NULL OR status = $1::job_status)
         AND ($2::text IS NULL OR job_type = $2::text)
         AND ($5::text IS NULL OR payload->>'businessId' = $5::text)
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [
        options.status ?? null,
        options.jobType ?? null,
        options.limit,
        options.offset,
        options.businessId ?? null,
      ],
    );
    return result.rows.map(mapJob);
  }

  async findById(jobId: string): Promise<Job | null> {
    const result = await this.db.query<JobRow>(
      `SELECT ${jobColumns} FROM job_queue WHERE id = $1`,
      [jobId],
    );
    const row = result.rows[0];
    return row ? mapJob(row) : null;
  }

  async retry(jobId: string, runAt: Date): Promise<Job | null> {
    const result = await this.db.query<JobRow>(
      `UPDATE job_queue
       SET status = 'pending', run_at = $2, locked_at = NULL, locked_by = NULL,
           attempts = CASE WHEN attempts >= max_attempts THEN 0 ELSE attempts END,
           completed_at = NULL, last_error = NULL, updated_at = now()
       WHERE id = $1 AND status IN ('failed', 'cancelled')
       RETURNING ${jobColumns}`,
      [jobId, runAt.toISOString()],
    );
    const row = result.rows[0];
    return row ? mapJob(row) : null;
  }

  async countByStatus(): Promise<Partial<Record<JobStatus, number>>> {
    const result = await this.db.query<{ status: JobStatus; count: number }>(
      `SELECT status, count(*)::integer AS count FROM job_queue GROUP BY status`,
    );
    return Object.fromEntries(result.rows.map((row) => [row.status, row.count]));
  }
}
