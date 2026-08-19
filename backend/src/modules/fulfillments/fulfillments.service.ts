import type { Pool } from "pg";

import { withTransaction } from "../../core/database/database.js";
import { AppError } from "../../core/errors/app-error.js";
import {
  ProviderFulfillmentInputError,
  ProviderFulfillmentResponseInvalidError,
  ProviderFulfillmentServiceTypeError,
  ProviderFulfillmentTemporarilyUnavailableError,
  ProviderFulfillmentUnavailableError,
  ProviderOrderRejectedError,
  ProviderSubmissionUnknownError,
  type ProviderOrderStatusResult,
} from "./fulfillments.adapter.js";
import { validateFulfillmentInput } from "./fulfillments.input.js";
import { ProviderFulfillmentRegistry } from "./fulfillments.registry.js";
import {
  type DispatchContext,
  type DispatchFulfillmentInput,
  type Fulfillment,
  type FulfillmentListItem,
  type FulfillmentListOptions,
  FulfillmentOrderItemUniqueError,
  type FulfillmentsRepository,
  type FulfillmentStatus,
} from "./fulfillments.types.js";

type SubmissionMode = "dispatch" | "retry";
type SafeWarning = (details: {
  fulfillmentId: string;
  providerKey: string;
  providerStatusRaw: string;
}) => void;

function fulfillmentNotFound(): AppError {
  return new AppError("Fulfillment not found", 404, "FULFILLMENT_NOT_FOUND");
}
function alreadyExists(): AppError {
  return new AppError("Fulfillment already exists", 409, "FULFILLMENT_ALREADY_EXISTS");
}
function notDispatchable(): AppError {
  return new AppError("Fulfillment is not dispatchable", 409, "FULFILLMENT_NOT_DISPATCHABLE");
}

export class FulfillmentsService {
  constructor(
    private readonly repository: FulfillmentsRepository,
    private readonly db: Pool,
    private readonly adapters: ProviderFulfillmentRegistry,
    private readonly now: () => Date = () => new Date(),
    private readonly warnUnknownStatus: SafeWarning = () => undefined,
  ) {}

  async dispatch(
    businessId: string,
    orderId: string,
    input: DispatchFulfillmentInput,
  ): Promise<Fulfillment> {
    const inputData = validateFulfillmentInput(input.input);
    let fulfillment: Fulfillment;
    try {
      fulfillment = await withTransaction(this.db, async (client) => {
        const orderStatus = await this.repository.lockOrderStatus(businessId, orderId, client);
        if (orderStatus === null) {
          throw new AppError("Order not found", 404, "ORDER_NOT_FOUND");
        }
        if (orderStatus !== "paid") {
          throw new AppError(
            "Order is not ready for fulfillment",
            409,
            "ORDER_NOT_READY_FOR_FULFILLMENT",
          );
        }
        const orderItem = await this.repository.findOrderItem(
          businessId,
          orderId,
          input.orderItemId,
          client,
        );
        if (!orderItem) throw new AppError("Order item not found", 404, "ORDER_ITEM_NOT_FOUND");
        const provider = await this.repository.findActiveProviderContext(
          businessId,
          orderItem.productId,
          client,
        );
        if (!provider) {
          throw new AppError(
            "Product provider mapping not found",
            404,
            "PRODUCT_PROVIDER_MAPPING_NOT_FOUND",
          );
        }
        if (provider.providerServiceStatus !== "active") {
          throw new AppError("Provider service is inactive", 409, "PROVIDER_SERVICE_INACTIVE");
        }
        if (provider.integrationStatus !== "active") {
          throw new AppError("Integration is inactive", 409, "INTEGRATION_INACTIVE");
        }
        if (
          (provider.providerMinQuantity !== null &&
            orderItem.quantity < provider.providerMinQuantity) ||
          (provider.providerMaxQuantity !== null &&
            orderItem.quantity > provider.providerMaxQuantity)
        ) {
          throw new AppError(
            "Provider does not support this quantity",
            409,
            "PROVIDER_QUANTITY_NOT_SUPPORTED",
          );
        }
        const context: DispatchContext = { orderStatus, ...orderItem, ...provider };
        return this.repository.create(businessId, orderId, context, inputData, client);
      });
    } catch (error) {
      if (!(error instanceof FulfillmentOrderItemUniqueError)) throw error;
      const existing = await this.repository.findByOrderItem(businessId, input.orderItemId);
      if (!existing || existing.orderId !== orderId) throw alreadyExists();
      if (existing.status !== "pending") throw alreadyExists();
      fulfillment = existing;
    }
    return this.submit(businessId, fulfillment, "dispatch");
  }

  async retry(businessId: string, fulfillmentId: string): Promise<Fulfillment> {
    const fulfillment = await this.getById(businessId, fulfillmentId);
    if (fulfillment.status === "submission_unknown") {
      throw new AppError(
        "Submission outcome is unknown and cannot be retried",
        409,
        "FULFILLMENT_SUBMISSION_UNKNOWN",
      );
    }
    if (fulfillment.status !== "failed") throw notDispatchable();
    return this.submit(businessId, fulfillment, "retry");
  }

  async syncStatus(businessId: string, fulfillmentId: string): Promise<Fulfillment> {
    const fulfillment = await this.getById(businessId, fulfillmentId);
    if (fulfillment.providerOrderId === null) throw notDispatchable();
    const adapter = this.adapters.resolve(fulfillment.providerKey);
    if (!adapter) {
      throw new AppError("Provider is not available", 503, "PROVIDER_TEMPORARILY_UNAVAILABLE");
    }
    let result: ProviderOrderStatusResult;
    try {
      result = await adapter.getOrderStatus({
        businessId,
        integrationId: fulfillment.integrationId,
        providerOrderId: fulfillment.providerOrderId,
      });
    } catch (error) {
      if (
        error instanceof ProviderFulfillmentTemporarilyUnavailableError ||
        error instanceof ProviderFulfillmentUnavailableError
      ) {
        throw new AppError(
          "Provider is temporarily unavailable",
          503,
          "PROVIDER_TEMPORARILY_UNAVAILABLE",
        );
      }
      if (error instanceof ProviderFulfillmentResponseInvalidError) {
        throw new AppError("Provider response is invalid", 502, "PROVIDER_RESPONSE_INVALID");
      }
      throw error;
    }
    if (result.providerOrderId !== fulfillment.providerOrderId) {
      throw new AppError("Provider response is invalid", 502, "PROVIDER_RESPONSE_INVALID");
    }
    return withTransaction(this.db, async (client) => {
      const locked = await this.repository.lockById(businessId, fulfillmentId, client);
      if (!locked) throw fulfillmentNotFound();
      if (locked.providerOrderId !== result.providerOrderId) {
        throw new AppError("Provider response is invalid", 502, "PROVIDER_RESPONSE_INVALID");
      }
      const orderStatus = await this.repository.lockOrderStatus(
        businessId,
        locked.orderId,
        client,
      );
      if (orderStatus === null) throw new AppError("Order not found", 404, "ORDER_NOT_FOUND");
      const nextStatus = this.resolveNextStatus(locked.status, result.status);
      if (result.status === null) {
        this.warnUnknownStatus({
          fulfillmentId: locked.id,
          providerKey: locked.providerKey,
          providerStatusRaw: result.providerStatusRaw,
        });
      }
      const syncedAt = this.now().toISOString();
      const updated = await this.repository.applyProviderStatus(
        businessId,
        locked.id,
        {
          providerStatusRaw: result.providerStatusRaw,
          status: nextStatus,
          providerCharge: result.charge ?? locked.providerCharge,
          providerCurrency: result.currency ?? locked.providerCurrency,
          providerRemains: result.remains ?? locked.providerRemains,
          providerStartCount: result.startCount ?? locked.providerStartCount,
          lastStatusSyncedAt: syncedAt,
          completedAt: nextStatus === "completed"
            ? (locked.completedAt ?? syncedAt)
            : null,
        },
        client,
      );
      if (!updated) throw fulfillmentNotFound();

      if (nextStatus === "completed") {
        const remaining = await this.repository.countNotCompletedByOrder(
          businessId,
          locked.orderId,
          client,
        );
        if (remaining === 0 && orderStatus === "processing") {
          await this.repository.transitionOrder(
            businessId, locked.orderId, "processing", "completed", client,
          );
        }
      } else if (
        (nextStatus === "partial" || nextStatus === "cancelled") &&
        orderStatus === "processing"
      ) {
        await this.repository.transitionOrder(
          businessId, locked.orderId, "processing", "failed", client,
        );
      }
      return updated;
    });
  }

  listByOrder(businessId: string, orderId: string): Promise<Fulfillment[]> {
    return this.repository.listByOrder(businessId, orderId);
  }

  async list(
    businessId: string,
    options: FulfillmentListOptions,
  ): Promise<FulfillmentListItem[]> {
    const fulfillments = await this.repository.list(businessId, options);
    return fulfillments.map(({ inputData: _inputData, ...safe }) => safe);
  }

  async getById(businessId: string, fulfillmentId: string): Promise<Fulfillment> {
    const fulfillment = await this.repository.findById(businessId, fulfillmentId);
    if (!fulfillment) throw fulfillmentNotFound();
    return fulfillment;
  }

  private async submit(
    businessId: string,
    fulfillment: Fulfillment,
    mode: SubmissionMode,
  ): Promise<Fulfillment> {
    const adapter = this.adapters.resolve(fulfillment.providerKey);
    if (!adapter) {
      throw new AppError("Provider is not available", 503, "PROVIDER_TEMPORARILY_UNAVAILABLE");
    }
    const submitting = await withTransaction(this.db, async (client) => {
      const locked = await this.repository.lockById(businessId, fulfillment.id, client);
      if (!locked) throw fulfillmentNotFound();
      const expected = mode === "dispatch" ? "pending" : "failed";
      if (locked.status !== expected) {
        if (locked.status === "submission_unknown") {
          throw new AppError(
            "Submission outcome is unknown and cannot be retried",
            409,
            "FULFILLMENT_SUBMISSION_UNKNOWN",
          );
        }
        throw alreadyExists();
      }
      const orderStatus = await this.repository.lockOrderStatus(
        businessId,
        locked.orderId,
        client,
      );
      if (orderStatus !== "paid") {
        throw new AppError(
          "Order is not ready for fulfillment",
          409,
          "ORDER_NOT_READY_FOR_FULFILLMENT",
        );
      }
      const updated = await this.repository.markSubmitting(
        businessId,
        locked.id,
        this.now().toISOString(),
        client,
      );
      if (!updated) throw notDispatchable();
      return updated;
    });

    let providerOrderId: string;
    try {
      const result = await adapter.createOrder({
        businessId,
        integrationId: submitting.integrationId,
        externalServiceId: submitting.externalServiceId,
        serviceType: submitting.providerServiceType,
        quantity: submitting.quantity,
        fulfillmentInput: submitting.inputData,
      });
      providerOrderId = result.providerOrderId;
    } catch (error) {
      if (error instanceof ProviderFulfillmentServiceTypeError) {
        await this.finishUnsuccessfulSubmission(businessId, submitting.id, "failed");
        throw new AppError(
          "Fulfillment service type is not supported",
          409,
          "FULFILLMENT_SERVICE_TYPE_NOT_SUPPORTED",
        );
      }
      if (error instanceof ProviderFulfillmentInputError) {
        await this.finishUnsuccessfulSubmission(businessId, submitting.id, "failed");
        throw new AppError("Invalid fulfillment input", 400, "FULFILLMENT_INPUT_INVALID");
      }
      if (error instanceof ProviderOrderRejectedError) {
        await this.finishUnsuccessfulSubmission(businessId, submitting.id, "failed");
        throw new AppError("Provider rejected the order", 409, "PROVIDER_ORDER_REJECTED");
      }
      if (error instanceof ProviderFulfillmentUnavailableError) {
        await this.finishUnsuccessfulSubmission(businessId, submitting.id, "failed");
        throw new AppError("Provider is not available", 503, "PROVIDER_TEMPORARILY_UNAVAILABLE");
      }
      await this.finishUnsuccessfulSubmission(businessId, submitting.id, "submission_unknown");
      throw new AppError(
        "Provider submission outcome is unknown",
        503,
        "FULFILLMENT_SUBMISSION_UNKNOWN",
      );
    }

    try {
      return await withTransaction(this.db, async (client) => {
        const locked = await this.repository.lockById(businessId, submitting.id, client);
        if (!locked || locked.status !== "submitting") throw notDispatchable();
        const orderStatus = await this.repository.lockOrderStatus(
          businessId,
          locked.orderId,
          client,
        );
        if (orderStatus !== "paid") throw notDispatchable();
        const submittedAt = this.now().toISOString();
        const updated = await this.repository.markSubmitted(
          businessId,
          locked.id,
          providerOrderId,
          submittedAt,
          client,
        );
        if (!updated) throw notDispatchable();
        const orderUpdated = await this.repository.transitionOrder(
          businessId,
          locked.orderId,
          "paid",
          "processing",
          client,
        );
        if (!orderUpdated) throw notDispatchable();
        return updated;
      });
    } catch {
      try {
        await this.finishUnsuccessfulSubmission(businessId, submitting.id, "submission_unknown");
      } catch {
        // The provider may already have created the order; never retry automatically.
      }
      throw new AppError(
        "Provider submission outcome is unknown",
        503,
        "FULFILLMENT_SUBMISSION_UNKNOWN",
      );
    }
  }

  private finishUnsuccessfulSubmission(
    businessId: string,
    fulfillmentId: string,
    status: "failed" | "submission_unknown",
  ): Promise<Fulfillment> {
    return withTransaction(this.db, async (client) => {
      const locked = await this.repository.lockById(businessId, fulfillmentId, client);
      if (!locked) throw fulfillmentNotFound();
      const updated = status === "failed"
        ? await this.repository.markFailed(businessId, fulfillmentId, client)
        : await this.repository.markSubmissionUnknown(businessId, fulfillmentId, client);
      if (!updated) throw notDispatchable();
      return updated;
    });
  }

  private resolveNextStatus(
    current: FulfillmentStatus,
    provider: ProviderOrderStatusResult["status"],
  ): FulfillmentStatus {
    if (provider === null) return current;
    if (["completed", "partial", "cancelled"].includes(current)) return current;
    if (current === "in_progress" && provider === "submitted") return current;
    if (current === "submitted" || current === "in_progress") return provider;
    return current;
  }
}
