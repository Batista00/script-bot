import { AppError } from "../../core/errors/app-error.js";
import type { JobSweepsRepository } from "./jobs.sweeps.repository.js";
import type { JobsService } from "./jobs.service.js";
import { jobTypes } from "./jobs.types.js";
import type { Job, JobHandler, JobLogger, JobOutcome } from "./jobs.types.js";

export interface DispatchOrderItemResult {
  fulfillmentId: string;
}

export interface DispatchOrderResult {
  dispatched: DispatchOrderItemResult[];
  skipped: number;
  failures: Array<{ orderItemId: string; code: string; message: string; retryable: boolean }>;
}

export interface JobHandlerDependencies {
  jobs: JobsService;
  sweeps: JobSweepsRepository;
  logger: JobLogger;
  fulfillments: {
    dispatchOrder(businessId: string, orderId: string): Promise<DispatchOrderResult>;
    syncStatus(businessId: string, fulfillmentId: string): Promise<{ id: string; status: string }>;
  };
  payments: {
    reconcilePending(
      businessId: string,
      paymentId: string,
    ): Promise<"ignored" | "pending" | "terminal">;
  };
  sessions: {
    deleteExpired(limit?: number): Promise<number>;
  };
  limits: {
    sweepBatch: number;
    syncMaxAttempts: number;
    reconcileMaxAttempts: number;
    syncDelaySeconds: number;
    syncMaxDelaySeconds: number;
    reconcileDelaySeconds: number;
    reconcileMaxDelaySeconds: number;
  };
}

function readIdentifier(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 200 ? normalized : null;
}

function missingPayload(...keys: string[]): JobOutcome {
  return { status: "failed", error: `Job payload is missing ${keys.join(", ")}` };
}

function syncDelay(dependencies: JobHandlerDependencies, attempts: number): number {
  const exponent = Math.min(Math.max(0, attempts - 1), 8);
  const delay = dependencies.limits.syncDelaySeconds * 2 ** exponent;
  return Math.min(delay, dependencies.limits.syncMaxDelaySeconds);
}

function reconcileDelay(dependencies: JobHandlerDependencies, attempts: number): number {
  const exponent = Math.min(Math.max(0, attempts - 1), 8);
  const delay = dependencies.limits.reconcileDelaySeconds * 2 ** exponent;
  return Math.min(delay, dependencies.limits.reconcileMaxDelaySeconds);
}

const terminalFulfillmentStatuses = new Set([
  "completed", "partial", "cancelled", "failed", "submission_unknown",
]);

export function createJobHandlers(
  dependencies: JobHandlerDependencies,
): Record<string, JobHandler> {
  const { jobs, sweeps, logger, limits } = dependencies;

  const orderFulfill: JobHandler = async (job: Job) => {
    const businessId = readIdentifier(job.payload, "businessId");
    const orderId = readIdentifier(job.payload, "orderId");
    if (!businessId || !orderId) return missingPayload("businessId", "orderId");

    let result: DispatchOrderResult;
    try {
      result = await dependencies.fulfillments.dispatchOrder(businessId, orderId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: "retry", delaySeconds: 60, error: message };
    }

    for (const dispatched of result.dispatched) {
      await jobs.enqueue({
        jobType: jobTypes.fulfillmentSync,
        jobKey: dispatched.fulfillmentId,
        payload: { businessId, fulfillmentId: dispatched.fulfillmentId },
        maxAttempts: limits.syncMaxAttempts,
      });
    }

    const retryable = result.failures.filter((failure) => failure.retryable);
    const permanent = result.failures.filter((failure) => !failure.retryable);
    logger.info(
      {
        businessId,
        orderId,
        dispatched: result.dispatched.length,
        skipped: result.skipped,
        retryable: retryable.length,
        permanent: permanent.length,
      },
      "Order fulfillment processed",
    );

    if (retryable.length > 0) {
      return {
        status: "retry",
        delaySeconds: 120,
        error: retryable.map((failure) => `${failure.code}: ${failure.message}`).join(" | "),
      };
    }
    if (permanent.length > 0) {
      return {
        status: "failed",
        error: permanent.map((failure) => `${failure.code}: ${failure.message}`).join(" | "),
      };
    }
    return { status: "completed" };
  };

  const fulfillmentSync: JobHandler = async (job: Job) => {
    const businessId = readIdentifier(job.payload, "businessId");
    const fulfillmentId = readIdentifier(job.payload, "fulfillmentId");
    if (!businessId || !fulfillmentId) return missingPayload("businessId", "fulfillmentId");

    let fulfillment: { id: string; status: string };
    try {
      fulfillment = await dependencies.fulfillments.syncStatus(businessId, fulfillmentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: "retry", delaySeconds: syncDelay(dependencies, job.attempts), error: message };
    }

    if (terminalFulfillmentStatuses.has(fulfillment.status)) {
      return { status: "completed" };
    }
    return {
      status: "retry",
      delaySeconds: syncDelay(dependencies, job.attempts),
      error: `Fulfillment still ${fulfillment.status}`,
    };
  };

  const paymentReconcile: JobHandler = async (job: Job) => {
    const businessId = readIdentifier(job.payload, "businessId");
    const paymentId = readIdentifier(job.payload, "paymentId");
    if (!businessId || !paymentId) return missingPayload("businessId", "paymentId");

    let outcome: "ignored" | "pending" | "terminal";
    try {
      outcome = await dependencies.payments.reconcilePending(businessId, paymentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A 4xx application error means the reconciliation itself is invalid
      // (amount/currency/provider mismatch): retrying will not fix it.
      if (error instanceof AppError && error.statusCode < 500) {
        return { status: "failed", error: `${error.code}: ${message}` };
      }
      return {
        status: "retry",
        delaySeconds: reconcileDelay(dependencies, job.attempts),
        error: message,
      };
    }
    if (outcome !== "pending") return { status: "completed" };
    if (job.attempts >= limits.reconcileMaxAttempts) {
      logger.warn({ businessId, paymentId, attempts: job.attempts }, "Payment reconciliation gave up");
      return { status: "completed" };
    }
    return {
      status: "retry",
      delaySeconds: reconcileDelay(dependencies, job.attempts),
      error: "Payment still pending",
    };
  };

  const reconcileOrders: JobHandler = async () => {
    const orders = await sweeps.listOrdersAwaitingFulfillment(limits.sweepBatch);
    for (const order of orders) {
      await jobs.enqueue({
        jobType: jobTypes.orderFulfill,
        jobKey: order.orderId,
        payload: { businessId: order.businessId, orderId: order.orderId },
        maxAttempts: limits.reconcileMaxAttempts,
        reopenFailed: true,
      });
    }
    return { status: "completed" };
  };

  const reconcileFulfillments: JobHandler = async () => {
    const fulfillments = await sweeps.listFulfillmentsToSync(limits.sweepBatch);
    for (const fulfillment of fulfillments) {
      await jobs.enqueue({
        jobType: jobTypes.fulfillmentSync,
        jobKey: fulfillment.fulfillmentId,
        payload: { businessId: fulfillment.businessId, fulfillmentId: fulfillment.fulfillmentId },
        maxAttempts: limits.syncMaxAttempts,
        reopenFailed: true,
      });
    }
    return { status: "completed" };
  };

  const reconcilePayments: JobHandler = async () => {
    const payments = await sweeps.listPaymentsToReconcile(limits.sweepBatch);
    for (const payment of payments) {
      await jobs.enqueue({
        jobType: jobTypes.paymentReconcile,
        jobKey: payment.paymentId,
        payload: { businessId: payment.businessId, paymentId: payment.paymentId },
        maxAttempts: limits.reconcileMaxAttempts,
        reopenFailed: true,
      });
    }
    return { status: "completed" };
  };

  const pruneSessions: JobHandler = async () => {
    const deleted = await dependencies.sessions.deleteExpired(limits.sweepBatch);
    if (deleted > 0) logger.info({ deleted }, "Expired sessions pruned");
    return { status: "completed" };
  };

  return {
    [jobTypes.orderFulfill]: orderFulfill,
    [jobTypes.fulfillmentSync]: fulfillmentSync,
    [jobTypes.paymentReconcile]: paymentReconcile,
    [jobTypes.reconcileOrders]: reconcileOrders,
    [jobTypes.reconcileFulfillments]: reconcileFulfillments,
    [jobTypes.reconcilePayments]: reconcilePayments,
    [jobTypes.pruneSessions]: pruneSessions,
  };
}
