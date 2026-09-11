import { jobTypes } from "./jobs.types.js";
import type { JobsService } from "./jobs.service.js";
import type { JobLogger } from "./jobs.types.js";
import type { JsonObject } from "../integrations/integrations.types.js";

export interface JobsSchedulerOptions {
  reconcileOrdersSeconds: number;
  reconcileFulfillmentsSeconds: number;
  reconcilePaymentsSeconds: number;
  pruneSessionsSeconds: number;
  sweepBatch: number;
  orderFulfillMaxAttempts: number;
  syncMaxAttempts: number;
  reconcileMaxAttempts: number;
  logger: JobLogger;
}

interface ScheduledTask {
  name: string;
  jobType: string;
  intervalSeconds: number;
  maxAttempts: number;
  payload: JsonObject;
}

/**
 * Periodically enqueues maintenance work into the same persistent queue the
 * worker drains. Bucket keys make each interval idempotent, so restarting the
 * worker (or running two of them) never duplicates a sweep.
 */
export class JobsScheduler {
  private readonly lastRun = new Map<string, number>();
  private readonly tasks: ScheduledTask[];

  constructor(
    private readonly jobs: JobsService,
    private readonly options: JobsSchedulerOptions,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.tasks = [
      {
        name: jobTypes.reconcileOrders,
        jobType: jobTypes.reconcileOrders,
        intervalSeconds: options.reconcileOrdersSeconds,
        maxAttempts: options.reconcileMaxAttempts,
        payload: {},
      },
      {
        name: jobTypes.reconcileFulfillments,
        jobType: jobTypes.reconcileFulfillments,
        intervalSeconds: options.reconcileFulfillmentsSeconds,
        maxAttempts: options.reconcileMaxAttempts,
        payload: {},
      },
      {
        name: jobTypes.reconcilePayments,
        jobType: jobTypes.reconcilePayments,
        intervalSeconds: options.reconcilePaymentsSeconds,
        maxAttempts: options.reconcileMaxAttempts,
        payload: {},
      },
      {
        name: jobTypes.pruneSessions,
        jobType: jobTypes.pruneSessions,
        intervalSeconds: options.pruneSessionsSeconds,
        maxAttempts: 3,
        payload: {},
      },
    ].filter((task) => task.intervalSeconds > 0);
  }

  async tick(): Promise<number> {
    const now = this.now();
    let enqueued = 0;
    for (const task of this.tasks) {
      const intervalMs = task.intervalSeconds * 1_000;
      const previous = this.lastRun.get(task.name);
      if (previous !== undefined && now.getTime() - previous < intervalMs) continue;
      this.lastRun.set(task.name, now.getTime());
      const bucket = Math.floor(now.getTime() / intervalMs);
      const job = await this.jobs.enqueue({
        jobType: task.jobType,
        jobKey: `bucket:${bucket}`,
        payload: task.payload,
        maxAttempts: task.maxAttempts,
        priority: -10,
        reopenFailed: true,
      });
      if (job) {
        enqueued += 1;
        this.options.logger.info({ jobType: task.jobType }, "Maintenance job enqueued");
      }
    }
    return enqueued;
  }
}
