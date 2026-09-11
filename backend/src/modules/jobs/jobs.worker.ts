import type { JobsRepository, JobLogger, Job, JobOutcome } from "./jobs.types.js";
import { JobHandlerNotFoundError, JobRegistry } from "./jobs.registry.js";

export interface JobsWorkerOptions {
  workerId: string;
  batchSize: number;
  pollIntervalMs: number;
  leaseSeconds: number;
  backoffBaseSeconds: number;
  backoffMaxSeconds: number;
  logger: JobLogger;
}

function truncateError(error: unknown, maximum = 2000): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.replace(/[\r\n]+/g, " ").trim();
  return normalized.length === 0 ? "Unknown error" : normalized.slice(0, maximum);
}

export class JobsWorker {
  private stopping = false;

  constructor(
    private readonly jobs: JobsRepository,
    private readonly registry: JobRegistry,
    private readonly options: JobsWorkerOptions,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * One scheduling cycle: recover stalled leases, claim a batch and process it.
   * Returns how many jobs were claimed so callers (and tests) can drive the loop.
   */
  async tick(): Promise<number> {
    const released = await this.jobs.releaseStalled(this.options.leaseSeconds);
    if (released > 0) {
      this.options.logger.warn({ released }, "Requeued stalled jobs");
    }
    const claimed = await this.jobs.claim(this.options.workerId, this.options.batchSize);
    for (const job of claimed) {
      await this.process(job);
    }
    return claimed.length;
  }

  async run(): Promise<void> {
    this.options.logger.info(
      { workerId: this.options.workerId, types: this.registry.types() },
      "Job worker started",
    );
    while (!this.stopping) {
      let claimed = 0;
      try {
        claimed = await this.tick();
      } catch (error) {
        this.options.logger.error({ err: truncateError(error) }, "Job worker cycle failed");
      }
      if (claimed === 0) await this.sleep(this.options.pollIntervalMs);
    }
    this.options.logger.info({ workerId: this.options.workerId }, "Job worker stopped");
  }

  stop(): void {
    this.stopping = true;
  }

  private async process(job: Job): Promise<void> {
    const startedAt = Date.now();
    let outcome: JobOutcome;
    try {
      outcome = await this.registry.resolve(job)(job);
    } catch (error) {
      if (error instanceof JobHandlerNotFoundError) {
        await this.jobs.fail(job.id, this.options.workerId, error.message);
        this.options.logger.error({ jobType: job.jobType, jobId: job.id }, "Job handler missing");
        return;
      }
      // Unexpected failures (database down, network blip) are retried with
      // backoff until max_attempts, then parked as failed for the operator.
      const message = truncateError(error);
      if (job.attempts >= job.maxAttempts) {
        await this.jobs.fail(job.id, this.options.workerId, message);
        this.options.logger.error(
          { jobType: job.jobType, jobId: job.id, attempts: job.attempts, err: message },
          "Job failed permanently",
        );
        return;
      }
      const delay = this.backoffSeconds(job.attempts);
      await this.jobs.reschedule(
        job.id, this.options.workerId, this.runAt(delay), message,
      );
      this.options.logger.warn(
        { jobType: job.jobType, jobId: job.id, attempts: job.attempts, retryInSeconds: delay, err: message },
        "Job retry scheduled",
      );
      return;
    }

    if (outcome.status === "completed") {
      await this.jobs.complete(job.id, this.options.workerId);
      this.options.logger.info(
        { jobType: job.jobType, jobId: job.id, durationMs: Date.now() - startedAt },
        "Job completed",
      );
      return;
    }

    if (outcome.status === "retry") {
      const requested = Number.isFinite(outcome.delaySeconds) && outcome.delaySeconds > 0
        ? Math.ceil(outcome.delaySeconds)
        : this.backoffSeconds(job.attempts);
      const delay = Math.min(requested, this.options.backoffMaxSeconds);
      const message = outcome.error ?? "Job requested a retry";
      if (job.attempts >= job.maxAttempts) {
        await this.jobs.fail(job.id, this.options.workerId, message);
        this.options.logger.error(
          { jobType: job.jobType, jobId: job.id, attempts: job.attempts, err: message },
          "Job failed permanently",
        );
        return;
      }
      await this.jobs.reschedule(job.id, this.options.workerId, this.runAt(delay), message);
      this.options.logger.warn(
        { jobType: job.jobType, jobId: job.id, attempts: job.attempts, retryInSeconds: delay, err: message },
        "Job retry scheduled",
      );
      return;
    }

    await this.jobs.fail(job.id, this.options.workerId, outcome.error);
    this.options.logger.error(
      { jobType: job.jobType, jobId: job.id, err: outcome.error },
      "Job failed permanently",
    );
  }

  private backoffSeconds(attempts: number): number {
    const exponent = Math.max(0, attempts - 1);
    const delay = this.options.backoffBaseSeconds * 2 ** exponent;
    return Math.min(Math.max(1, Math.ceil(delay)), this.options.backoffMaxSeconds);
  }

  private runAt(delaySeconds: number): Date {
    return new Date(this.now().getTime() + delaySeconds * 1_000);
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, milliseconds);
      timer.unref?.();
    });
  }
}
