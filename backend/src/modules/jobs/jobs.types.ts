import type { DatabaseExecutor } from "../../core/database/database.js";
import type { JsonObject } from "../integrations/integrations.types.js";

export const jobStatuses = ["pending", "running", "completed", "failed", "cancelled"] as const;
export type JobStatus = (typeof jobStatuses)[number];

export interface Job {
  id: string;
  jobType: string;
  jobKey: string;
  payload: JsonObject;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const jobTypes = {
  orderFulfill: "order.fulfill",
  fulfillmentSync: "fulfillment.sync",
  paymentReconcile: "payment.reconcile",
  reconcileOrders: "maintenance.reconcile_orders",
  reconcileFulfillments: "maintenance.reconcile_fulfillments",
  reconcilePayments: "maintenance.reconcile_payments",
  pruneSessions: "maintenance.prune_sessions",
} as const;

export interface EnqueueJobInput {
  jobType: string;
  jobKey: string;
  payload?: JsonObject;
  priority?: number;
  maxAttempts?: number;
  runAt?: Date;
  /**
   * Maintenance sweeps re-open failed jobs so an operational fix (a mapping,
   * a credential) is picked up on the next cycle. Domain enqueues default to
   * false so a real failure is never retried silently.
   */
  reopenFailed?: boolean;
}

export interface JobListOptions {
  limit: number;
  offset: number;
  status?: JobStatus;
  jobType?: string;
  /** Limits the listing to jobs whose payload belongs to this business. */
  businessId?: string;
}

export interface JobsRepository {
  /** Inserts the job once; returns null when the (type, key) pair already exists. */
  enqueue(input: EnqueueJobInput, executor?: DatabaseExecutor): Promise<Job | null>;
  claim(workerId: string, limit: number, executor?: DatabaseExecutor): Promise<Job[]>;
  complete(jobId: string, workerId: string, executor?: DatabaseExecutor): Promise<boolean>;
  reschedule(
    jobId: string,
    workerId: string,
    runAt: Date,
    error: string | null,
    executor?: DatabaseExecutor,
  ): Promise<boolean>;
  fail(jobId: string, workerId: string, error: string, executor?: DatabaseExecutor): Promise<boolean>;
  /** Returns stalled leases to the queue, or fails them when attempts are exhausted. */
  releaseStalled(leaseSeconds: number, executor?: DatabaseExecutor): Promise<number>;
  list(options: JobListOptions): Promise<Job[]>;
  findById(jobId: string): Promise<Job | null>;
  retry(jobId: string, runAt: Date): Promise<Job | null>;
  countByStatus(): Promise<Partial<Record<JobStatus, number>>>;
}

export type JobOutcome =
  | { status: "completed" }
  | { status: "retry"; delaySeconds: number; error?: string }
  | { status: "failed"; error: string };

export type JobHandler = (job: Job) => Promise<JobOutcome>;

export interface JobLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}
