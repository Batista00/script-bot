import { hostname } from "node:os";

import type { Env } from "../../config/env.js";
import type { JobsSchedulerOptions } from "./jobs.scheduler.js";
import type { JobsWorkerOptions } from "./jobs.worker.js";
import type { JobLogger } from "./jobs.types.js";

export interface WorkerLimits {
  sweepBatch: number;
  syncMaxAttempts: number;
  reconcileMaxAttempts: number;
  syncDelaySeconds: number;
  syncMaxDelaySeconds: number;
  reconcileDelaySeconds: number;
  reconcileMaxDelaySeconds: number;
}

export interface WorkerSettings {
  worker: JobsWorkerOptions;
  scheduler: Omit<JobsSchedulerOptions, "logger"> & { logger: JobLogger };
  limits: WorkerLimits;
}

const sweepBatch = 50;
const syncMaxAttempts = 2_000;
const reconcileMaxAttempts = 120;

export function createWorkerSettings(config: Env, logger: JobLogger): WorkerSettings {
  const batchSize = config.WORKER_BATCH_SIZE ?? 10;
  return {
    worker: {
      workerId: `${hostname()}-${process.pid}`,
      batchSize,
      pollIntervalMs: config.WORKER_POLL_INTERVAL_MS ?? 2_000,
      leaseSeconds: config.WORKER_LEASE_SECONDS ?? 120,
      backoffBaseSeconds: 30,
      backoffMaxSeconds: 3_600,
      logger,
    },
    scheduler: {
      reconcileOrdersSeconds: config.WORKER_RECONCILE_ORDERS_SECONDS ?? 120,
      reconcileFulfillmentsSeconds: config.WORKER_RECONCILE_FULFILLMENTS_SECONDS ?? 180,
      reconcilePaymentsSeconds: config.WORKER_RECONCILE_PAYMENTS_SECONDS ?? 300,
      pruneSessionsSeconds: config.WORKER_PRUNE_SESSIONS_SECONDS ?? 21_600,
      sweepBatch,
      orderFulfillMaxAttempts: 20,
      syncMaxAttempts,
      reconcileMaxAttempts,
      logger,
    },
    limits: {
      sweepBatch,
      syncMaxAttempts,
      reconcileMaxAttempts,
      syncDelaySeconds: 60,
      syncMaxDelaySeconds: 1_800,
      reconcileDelaySeconds: 60,
      reconcileMaxDelaySeconds: 1_800,
    },
  };
}
