import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { createDatabasePool } from "../../src/core/database/database.js";
import { PostgresJobSweepsRepository } from "../../src/modules/jobs/jobs.sweeps.repository.js";
import { PostgresJobsRepository } from "../../src/modules/jobs/jobs.repository.js";
import { JobsService } from "../../src/modules/jobs/jobs.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test(
  "job queue guarantees with PostgreSQL",
  { skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is not configured" },
  async (t) => {
    if (!testDatabaseUrl) return;
    await runner({
      databaseUrl: testDatabaseUrl,
      direction: "up",
      dir: "migrations",
      migrationsTable: "pgmigrations",
      count: Infinity,
      log: () => undefined,
    });
    const db = createDatabasePool(testDatabaseUrl);
    t.after(async () => db.end());
    const repository = new PostgresJobsRepository(db);
    const jobs = new JobsService(repository);
    const key = `queue-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // Enqueue is idempotent per (type, key).
    const first = await jobs.enqueue({
      jobType: "test.queue",
      jobKey: key,
      payload: { businessId: key },
    });
    assert.ok(first);
    assert.equal(await jobs.enqueue({ jobType: "test.queue", jobKey: key }), null);

    // Two workers racing for the same row: exactly one wins.
    const [workerA, workerB] = await Promise.all([
      repository.claim("worker-a", 5),
      repository.claim("worker-b", 5),
    ]);
    const claimed = [...workerA, ...workerB].filter((job) => job.jobKey === key);
    assert.equal(claimed.length, 1);
    const claimedJob = claimed[0]!;
    assert.equal(claimedJob.status, "running");
    assert.equal(claimedJob.attempts, 1);
    assert.ok(claimedJob.lockedBy);

    // A second claim while the lease is held returns nothing for that job.
    const whileLocked = await repository.claim("worker-c", 5);
    assert.equal(whileLocked.some((job) => job.jobKey === key), false);

    // Complete releases the lease and does not resurrect the job.
    assert.equal(await repository.complete(claimedJob.id, claimedJob.lockedBy!), true);
    assert.equal(await repository.complete(claimedJob.id, claimedJob.lockedBy!), false);
    const completed = await repository.findById(claimedJob.id);
    assert.equal(completed?.status, "completed");
    assert.ok(completed?.completedAt);
    assert.equal(completed?.lockedAt, null);

    // A stalled lease is recovered by another worker.
    const stalled = await jobs.enqueue({
      jobType: "test.queue",
      jobKey: `${key}-stalled`,
      payload: { businessId: key },
      maxAttempts: 3,
    });
    await repository.claim("worker-dead", 5);
    await db.query(
      `UPDATE job_queue SET locked_at = now() - interval '1 hour' WHERE id = $1`,
      [stalled!.id],
    );
    const released = await repository.releaseStalled(120);
    assert.ok(released >= 1);
    const requeued = await repository.findById(stalled!.id);
    assert.equal(requeued?.status, "pending");
    assert.equal(requeued?.lockedAt, null);
    assert.ok(requeued?.lastError);

    // Exhausted attempts park the job as failed instead of looping forever.
    await repository.claim("worker-dead-2", 5);
    await db.query(
      `UPDATE job_queue SET attempts = max_attempts, locked_at = now() - interval '1 hour'
       WHERE id = $1`,
      [stalled!.id],
    );
    await repository.releaseStalled(120);
    const failed = await repository.findById(stalled!.id);
    assert.equal(failed?.status, "failed");

    // Failed work can be re-opened by a maintenance sweep.
    const reopened = await jobs.enqueue({
      jobType: "test.queue",
      jobKey: `${key}-stalled`,
      reopenFailed: true,
    });
    assert.equal(reopened?.status, "pending");
    assert.equal(reopened?.attempts, 0);

    // Manual retry keeps the consumed budget while attempts remain...
    await repository.claim("worker-e", 5);
    await repository.fail(reopened!.id, "worker-e", "boom");
    const retried = await jobs.retry(reopened!.id);
    assert.equal(retried.status, "pending");
    assert.equal(retried.attempts, 1);
    assert.equal(retried.lastError, null);

    // ...and resets it once the budget is exhausted, so the operator gets a
    // full set of attempts after fixing the cause.
    await repository.claim("worker-f", 5);
    await db.query("UPDATE job_queue SET attempts = max_attempts WHERE id = $1", [reopened!.id]);
    await repository.fail(reopened!.id, "worker-f", "boom again");
    const retriedAgain = await jobs.retry(reopened!.id);
    assert.equal(retriedAgain.attempts, 0);

    // A job whose budget is exhausted is never claimed again.
    await db.query("UPDATE job_queue SET attempts = max_attempts WHERE id = $1", [reopened!.id]);
    const exhaustedClaims = (await repository.claim("worker-g", 50))
      .filter((job) => job.id === reopened!.id);
    assert.equal(exhaustedClaims.length, 0);

    const stats = await jobs.stats();
    assert.ok((stats.pending ?? 0) >= 1);

    await db.query("DELETE FROM job_queue WHERE job_key LIKE $1", [`${key}%`]);
  },
);

test(
  "maintenance sweeps find the work they must re-enqueue",
  { skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is not configured" },
  async (t) => {
    if (!testDatabaseUrl) return;
    await runner({
      databaseUrl: testDatabaseUrl,
      direction: "up",
      dir: "migrations",
      migrationsTable: "pgmigrations",
      count: Infinity,
      log: () => undefined,
    });
    const db = createDatabasePool(testDatabaseUrl);
    t.after(async () => db.end());
    const sweeps = new PostgresJobSweepsRepository(db);
    // The sweeps are global queries; they must at least run and stay bounded.
    for (const rows of [
      await sweeps.listOrdersAwaitingFulfillment(5),
      await sweeps.listFulfillmentsToSync(5),
      await sweeps.listPaymentsToReconcile(5),
    ]) {
      assert.ok(Array.isArray(rows));
      assert.ok(rows.length <= 5);
    }
  },
);
