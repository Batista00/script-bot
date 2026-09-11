import type { DatabaseExecutor } from "../../core/database/database.js";
import { AppError } from "../../core/errors/app-error.js";
import type {
  EnqueueJobInput,
  Job,
  JobListOptions,
  JobsRepository,
} from "./jobs.types.js";

export interface JobStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export class JobsService {
  constructor(private readonly repository: JobsRepository) {}

  /**
   * Enqueues a job once. Used inside domain transactions, so the caller can
   * make "state change + work to do" atomic without external calls.
   */
  enqueue(input: EnqueueJobInput, executor?: DatabaseExecutor): Promise<Job | null> {
    return this.repository.enqueue(input, executor);
  }

  list(options: JobListOptions): Promise<Job[]> {
    return this.repository.list(options);
  }

  async getById(jobId: string): Promise<Job> {
    const job = await this.repository.findById(jobId);
    if (!job) throw new AppError("Job not found", 404, "JOB_NOT_FOUND");
    return job;
  }

  async retry(jobId: string, runAt = new Date()): Promise<Job> {
    const job = await this.repository.retry(jobId, runAt);
    if (!job) throw new AppError("Job cannot be retried", 409, "JOB_NOT_RETRYABLE");
    return job;
  }

  /** Retry scoped to a tenant: a job of another business is reported as missing. */
  async retryForBusiness(businessId: string, jobId: string): Promise<Job> {
    const job = await this.getById(jobId);
    if (job.payload.businessId !== businessId) {
      throw new AppError("Job not found", 404, "JOB_NOT_FOUND");
    }
    return this.retry(jobId);
  }

  async stats(): Promise<JobStats> {
    const counts = await this.repository.countByStatus();
    return {
      pending: counts.pending ?? 0,
      running: counts.running ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      cancelled: counts.cancelled ?? 0,
    };
  }
}
