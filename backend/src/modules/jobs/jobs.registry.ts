import type { Job, JobHandler } from "./jobs.types.js";

export class JobHandlerNotFoundError extends Error {}

/**
 * Maps a `job_type` to its handler. Registering the same type twice is a
 * composition error and fails fast at startup.
 */
export class JobRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  constructor(handlers: Readonly<Record<string, JobHandler>> = {}) {
    for (const [jobType, handler] of Object.entries(handlers)) {
      this.register(jobType, handler);
    }
  }

  register(jobType: string, handler: JobHandler): void {
    if (this.handlers.has(jobType)) throw new Error(`Duplicate job handler: ${jobType}`);
    this.handlers.set(jobType, handler);
  }

  resolve(job: Pick<Job, "jobType">): JobHandler {
    const handler = this.handlers.get(job.jobType);
    if (!handler) throw new JobHandlerNotFoundError(`No handler for job type: ${job.jobType}`);
    return handler;
  }

  types(): string[] {
    return [...this.handlers.keys()];
  }
}
