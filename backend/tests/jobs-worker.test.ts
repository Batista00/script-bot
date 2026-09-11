import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { JobsScheduler } from "../src/modules/jobs/jobs.scheduler.js";
import { JobsService } from "../src/modules/jobs/jobs.service.js";
import { JobRegistry } from "../src/modules/jobs/jobs.registry.js";
import { JobsWorker } from "../src/modules/jobs/jobs.worker.js";
import { jobTypes } from "../src/modules/jobs/jobs.types.js";
import type {
  EnqueueJobInput,
  Job,
  JobHandler,
  JobListOptions,
  JobsRepository,
  JobStatus,
} from "../src/modules/jobs/jobs.types.js";

class MemoryJobsRepository implements JobsRepository {
  readonly jobs = new Map<string, Job>();
  private sequence = 0;

  async enqueue(input: EnqueueJobInput): Promise<Job | null> {
    const existing = [...this.jobs.values()].find((job) =>
      job.jobType === input.jobType && job.jobKey === input.jobKey);
    if (existing) {
      if (existing.status === "failed" && input.reopenFailed === true) {
        existing.status = "pending";
        existing.attempts = 0;
        existing.lastError = null;
        existing.runAt = new Date().toISOString();
        return structuredClone(existing);
      }
      return null;
    }
    this.sequence += 1;
    const job: Job = {
      id: randomUUID(),
      jobType: input.jobType,
      jobKey: input.jobKey,
      payload: input.payload ?? {},
      status: "pending",
      priority: input.priority ?? 0,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
      runAt: (input.runAt ?? new Date()).toISOString(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async claim(workerId: string, limit: number): Promise<Job[]> {
    const now = Date.now();
    const claimed = [...this.jobs.values()]
      .filter((job) => job.status === "pending" && Date.parse(job.runAt) <= now)
      .sort((left, right) => right.priority - left.priority)
      .slice(0, limit);
    for (const job of claimed) {
      job.status = "running";
      job.lockedAt = new Date().toISOString();
      job.lockedBy = workerId;
      job.attempts += 1;
    }
    return claimed.map((job) => structuredClone(job));
  }

  async complete(jobId: string, workerId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running" || job.lockedBy !== workerId) return false;
    job.status = "completed";
    job.completedAt = new Date().toISOString();
    job.lockedAt = null;
    job.lockedBy = null;
    return true;
  }

  async reschedule(jobId: string, workerId: string, runAt: Date, error: string | null): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running" || job.lockedBy !== workerId) return false;
    job.status = "pending";
    job.runAt = runAt.toISOString();
    job.lastError = error;
    job.lockedAt = null;
    job.lockedBy = null;
    return true;
  }

  async fail(jobId: string, workerId: string, error: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running" || job.lockedBy !== workerId) return false;
    job.status = "failed";
    job.lastError = error;
    job.lockedAt = null;
    job.lockedBy = null;
    return true;
  }

  async releaseStalled(leaseSeconds: number): Promise<number> {
    const threshold = Date.now() - leaseSeconds * 1_000;
    let released = 0;
    for (const job of this.jobs.values()) {
      if (job.status !== "running" || job.lockedAt === null) continue;
      if (Date.parse(job.lockedAt) >= threshold) continue;
      released += 1;
      job.lockedAt = null;
      job.lockedBy = null;
      if (job.attempts >= job.maxAttempts) job.status = "failed";
      else {
        job.status = "pending";
        job.runAt = new Date().toISOString();
      }
    }
    return released;
  }

  async list(options: JobListOptions): Promise<Job[]> {
    return [...this.jobs.values()]
      .filter((job) => options.status === undefined || job.status === options.status)
      .slice(options.offset, options.offset + options.limit)
      .map((job) => structuredClone(job));
  }

  async findById(jobId: string): Promise<Job | null> {
    const job = this.jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }

  async retry(jobId: string, runAt: Date): Promise<Job | null> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "failed") return null;
    job.status = "pending";
    job.attempts = 0;
    job.runAt = runAt.toISOString();
    return structuredClone(job);
  }

  async countByStatus(): Promise<Partial<Record<JobStatus, number>>> {
    const result: Partial<Record<JobStatus, number>> = {};
    for (const job of this.jobs.values()) {
      result[job.status] = (result[job.status] ?? 0) + 1;
    }
    return result;
  }

  byStatus(status: JobStatus): Job[] {
    return [...this.jobs.values()].filter((job) => job.status === status);
  }
}

const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

function createWorker(handlers: Record<string, JobHandler>, overrides: Partial<{
  batchSize: number; leaseSeconds: number; backoffBaseSeconds: number; backoffMaxSeconds: number;
}> = {}) {
  const repository = new MemoryJobsRepository();
  const worker = new JobsWorker(repository, new JobRegistry(handlers), {
    workerId: "worker-1",
    batchSize: overrides.batchSize ?? 10,
    pollIntervalMs: 1,
    leaseSeconds: overrides.leaseSeconds ?? 120,
    backoffBaseSeconds: overrides.backoffBaseSeconds ?? 30,
    backoffMaxSeconds: overrides.backoffMaxSeconds ?? 3_600,
    logger: silentLogger,
  });
  return { repository, worker };
}

test("a successful job is completed and released", async () => {
  const handled: string[] = [];
  const { repository, worker } = createWorker({
    "demo.ok": async (job) => {
      handled.push(job.jobKey);
      return { status: "completed" };
    },
  });
  await repository.enqueue({ jobType: "demo.ok", jobKey: "one" });

  assert.equal(await worker.tick(), 1);

  assert.deepEqual(handled, ["one"]);
  assert.equal(repository.byStatus("completed").length, 1);
  assert.equal(repository.byStatus("completed")[0]?.attempts, 1);
});

test("a throwing handler is retried with exponential backoff and parks failed at the limit", async () => {
  const { repository, worker } = createWorker({
    "demo.boom": async () => {
      throw new Error("provider down");
    },
  }, { backoffBaseSeconds: 30 });
  await repository.enqueue({ jobType: "demo.boom", jobKey: "one", maxAttempts: 3 });

  await worker.tick();
  const firstRetry = repository.byStatus("pending")[0];
  assert.equal(firstRetry?.attempts, 1);
  assert.equal(firstRetry?.lastError, "provider down");
  const firstDelay = Date.parse(firstRetry!.runAt) - Date.now();
  assert.ok(firstDelay > 20_000 && firstDelay <= 30_000, `delay was ${firstDelay}`);

  // The backoff keeps the job out of the next immediate claim.
  assert.equal(await worker.tick(), 0);
  firstRetry!.runAt = new Date(Date.now() - 1).toISOString();
  await worker.tick();
  const secondRetry = repository.byStatus("pending")[0];
  const secondDelay = Date.parse(secondRetry!.runAt) - Date.now();
  assert.ok(secondDelay > firstDelay, `${secondDelay} should exceed ${firstDelay}`);

  secondRetry!.runAt = new Date(Date.now() - 1).toISOString();
  await worker.tick();

  const failed = repository.byStatus("failed");
  assert.equal(failed.length, 1);
  assert.equal(failed[0]?.attempts, 3);
  assert.equal(repository.byStatus("pending").length, 0);
});

test("a handler can request a retry and a permanent failure explicitly", async () => {
  const { repository, worker } = createWorker({
    "demo.retry": async () => ({ status: "retry", delaySeconds: 5, error: "later" }),
    "demo.dead": async () => ({ status: "failed", error: "no mapping" }),
  });
  await repository.enqueue({ jobType: "demo.retry", jobKey: "a", maxAttempts: 5 });
  await repository.enqueue({ jobType: "demo.dead", jobKey: "b" });

  await worker.tick();

  const retried = [...repository.jobs.values()].find((job) => job.jobType === "demo.retry");
  assert.equal(retried?.status, "pending");
  assert.equal(retried?.lastError, "later");
  const delay = Date.parse(retried!.runAt) - Date.now();
  assert.ok(delay <= 5_000, `delay was ${delay}`);
  const dead = [...repository.jobs.values()].find((job) => job.jobType === "demo.dead");
  assert.equal(dead?.status, "failed");
  assert.equal(dead?.lastError, "no mapping");
});

test("an unregistered job type fails immediately instead of retrying forever", async () => {
  const { repository, worker } = createWorker({});
  await repository.enqueue({ jobType: "demo.unknown", jobKey: "x", maxAttempts: 5 });

  await worker.tick();

  const job = repository.byStatus("failed")[0];
  assert.equal(job?.attempts, 1);
  assert.match(job?.lastError ?? "", /No handler for job type/);
});

test("stalled leases are recovered and requeued, or failed when attempts are exhausted", async () => {
  const { repository, worker } = createWorker({ "demo.ok": async () => ({ status: "completed" }) }, {
    leaseSeconds: 120,
  });
  const stalled = await repository.enqueue({ jobType: "demo.ok", jobKey: "stalled", maxAttempts: 5 });
  const exhausted = await repository.enqueue({ jobType: "demo.ok", jobKey: "exhausted", maxAttempts: 1 });
  for (const job of [stalled!, exhausted!]) {
    job.status = "running";
    job.lockedBy = "dead-worker";
    job.lockedAt = new Date(Date.now() - 10 * 60 * 1_000).toISOString();
    job.attempts = job.jobKey === "exhausted" ? 1 : 2;
  }

  const released = await repository.releaseStalled(120);
  assert.equal(released, 2);
  assert.equal(repository.jobs.get(stalled!.id)?.status, "pending");
  assert.equal(repository.jobs.get(exhausted!.id)?.status, "failed");

  const claimable = await worker.tick();
  assert.equal(claimable, 1);
});

test("enqueue is idempotent per type and key and can reopen failed work", async () => {
  const repository = new MemoryJobsRepository();
  const jobs = new JobsService(repository);
  const first = await jobs.enqueue({ jobType: jobTypes.orderFulfill, jobKey: "order-1" });
  assert.ok(first);
  assert.equal(await jobs.enqueue({ jobType: jobTypes.orderFulfill, jobKey: "order-1" }), null);

  await repository.claim("worker", 1);
  await repository.fail(first!.id, "worker", "boom");
  assert.equal(await jobs.enqueue({ jobType: jobTypes.orderFulfill, jobKey: "order-1" }), null);
  const reopened = await jobs.enqueue({
    jobType: jobTypes.orderFulfill, jobKey: "order-1", reopenFailed: true,
  });
  assert.equal(reopened?.status, "pending");
  assert.equal(reopened?.attempts, 0);
});

test("the scheduler enqueues each maintenance sweep once per interval", async () => {
  const repository = new MemoryJobsRepository();
  const jobs = new JobsService(repository);
  let now = 1_000_000;
  const scheduler = new JobsScheduler(jobs, {
    reconcileOrdersSeconds: 120,
    reconcileFulfillmentsSeconds: 180,
    reconcilePaymentsSeconds: 300,
    pruneSessionsSeconds: 0,
    sweepBatch: 50,
    orderFulfillMaxAttempts: 20,
    syncMaxAttempts: 100,
    reconcileMaxAttempts: 100,
    logger: silentLogger,
  }, () => new Date(now));

  assert.equal(await scheduler.tick(), 3);
  assert.equal(await scheduler.tick(), 0);

  // Each sweep respects its own interval: after 120s only the fast one runs.
  now += 120_000;
  assert.equal(await scheduler.tick(), 1);
  now += 180_000;
  assert.equal(await scheduler.tick(), 3);
  const types = new Set([...repository.jobs.values()].map((job) => job.jobType));
  assert.deepEqual([...types].sort(), [
    jobTypes.reconcileFulfillments,
    jobTypes.reconcileOrders,
    jobTypes.reconcilePayments,
  ].sort());
  assert.equal(repository.jobs.size, 7);
});
