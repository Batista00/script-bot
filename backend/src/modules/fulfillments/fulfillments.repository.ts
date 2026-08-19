import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import type { JsonObject } from "../integrations/integrations.types.js";
import type { IntegrationStatus } from "../integrations/integrations.types.js";
import type { OrderStatus } from "../orders/orders.types.js";
import type { ProviderServiceStatus } from "../provider-catalog/provider-catalog.types.js";
import {
  type DispatchContext,
  type DispatchOrderItem,
  type DispatchProviderContext,
  type Fulfillment,
  FulfillmentOrderItemUniqueError,
  FulfillmentProviderOrderUniqueError,
  type FulfillmentsRepository,
  type FulfillmentStatus,
  type ProviderStatusPersistence,
} from "./fulfillments.types.js";

interface FulfillmentRow extends QueryResultRow {
  id: string;
  business_id: string;
  order_id: string;
  order_item_id: string;
  product_id: string;
  integration_id: string;
  provider_service_id: string;
  provider_key: string;
  external_service_id: string;
  provider_service_type: string | null;
  quantity: number;
  status: FulfillmentStatus;
  provider_order_id: string | null;
  provider_status_raw: string | null;
  input_data: JsonObject;
  provider_charge: string | null;
  provider_currency: string | null;
  provider_remains: number | null;
  provider_start_count: number | null;
  submission_attempted_at: Date | string | null;
  submitted_at: Date | string | null;
  last_status_synced_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProviderContextRow extends QueryResultRow {
  provider_service_id: string;
  integration_id: string;
  provider_key: string;
  external_service_id: string;
  service_type: string | null;
  provider_status: ProviderServiceStatus;
  min_quantity: number | null;
  max_quantity: number | null;
  integration_status: IntegrationStatus;
}

interface PostgreSqlError { code?: string; constraint?: string }

const columns = `id, business_id, order_id, order_item_id, product_id,
  integration_id, provider_service_id, provider_key, external_service_id,
  provider_service_type, quantity, status, provider_order_id, provider_status_raw,
  input_data, provider_charge, provider_currency, provider_remains,
  provider_start_count, submission_attempted_at, submitted_at,
  last_status_synced_at, completed_at, created_at, updated_at`;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function mapFulfillment(row: FulfillmentRow): Fulfillment {
  return {
    id: row.id,
    businessId: row.business_id,
    orderId: row.order_id,
    orderItemId: row.order_item_id,
    productId: row.product_id,
    integrationId: row.integration_id,
    providerServiceId: row.provider_service_id,
    providerKey: row.provider_key,
    externalServiceId: row.external_service_id,
    providerServiceType: row.provider_service_type,
    quantity: row.quantity,
    status: row.status,
    providerOrderId: row.provider_order_id,
    providerStatusRaw: row.provider_status_raw,
    inputData: row.input_data,
    providerCharge: row.provider_charge,
    providerCurrency: row.provider_currency,
    providerRemains: row.provider_remains,
    providerStartCount: row.provider_start_count,
    submissionAttemptedAt: nullableIso(row.submission_attempted_at),
    submittedAt: nullableIso(row.submitted_at),
    lastStatusSyncedAt: nullableIso(row.last_status_synced_at),
    completedAt: nullableIso(row.completed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapUnique(error: unknown): never {
  const pgError = error as PostgreSqlError;
  if (pgError.code === "23505" && pgError.constraint === "fulfillments_order_item_unique") {
    throw new FulfillmentOrderItemUniqueError();
  }
  if (pgError.code === "23505" && pgError.constraint === "fulfillments_provider_order_unique") {
    throw new FulfillmentProviderOrderUniqueError();
  }
  throw error;
}

export class PostgresFulfillmentsRepository implements FulfillmentsRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async lockOrderStatus(
    businessId: string,
    orderId: string,
    executor: DatabaseExecutor,
  ): Promise<OrderStatus | null> {
    const result = await executor.query<{ status: OrderStatus }>(
      `SELECT status FROM orders
       WHERE business_id = $1 AND id = $2 FOR UPDATE`,
      [businessId, orderId],
    );
    return result.rows[0]?.status ?? null;
  }

  async findOrderItem(
    businessId: string,
    orderId: string,
    orderItemId: string,
    executor: DatabaseExecutor,
  ): Promise<DispatchOrderItem | null> {
    const result = await executor.query<{
      id: string; product_id: string; quantity: number;
    }>(
      `SELECT id, product_id, quantity FROM order_items
       WHERE business_id = $1 AND order_id = $2 AND id = $3
       FOR UPDATE`,
      [businessId, orderId, orderItemId],
    );
    const row = result.rows[0];
    return row ? { orderItemId: row.id, productId: row.product_id, quantity: row.quantity } : null;
  }

  async findActiveProviderContext(
    businessId: string,
    productId: string,
    executor: DatabaseExecutor,
  ): Promise<DispatchProviderContext | null> {
    const result = await executor.query<ProviderContextRow>(
      `SELECT ps.id AS provider_service_id, ps.integration_id, ps.provider_key,
              ps.external_service_id, ps.service_type, ps.provider_status,
              ps.min_quantity, ps.max_quantity, bi.status AS integration_status
       FROM product_provider_mappings ppm
       JOIN provider_services ps
         ON ps.business_id = ppm.business_id AND ps.id = ppm.provider_service_id
       JOIN business_integrations bi
         ON bi.business_id = ps.business_id AND bi.id = ps.integration_id
       WHERE ppm.business_id = $1 AND ppm.product_id = $2 AND ppm.status = 'active'
       FOR UPDATE OF ppm, ps, bi`,
      [businessId, productId],
    );
    const row = result.rows[0];
    return row ? {
      providerServiceId: row.provider_service_id,
      integrationId: row.integration_id,
      providerKey: row.provider_key,
      externalServiceId: row.external_service_id,
      serviceType: row.service_type,
      providerServiceStatus: row.provider_status,
      providerMinQuantity: row.min_quantity,
      providerMaxQuantity: row.max_quantity,
      integrationStatus: row.integration_status,
    } : null;
  }

  async create(
    businessId: string,
    orderId: string,
    context: DispatchContext,
    inputData: JsonObject,
    executor: DatabaseExecutor,
  ): Promise<Fulfillment> {
    try {
      const result = await executor.query<FulfillmentRow>(
        `INSERT INTO fulfillments (
           business_id, order_id, order_item_id, product_id, integration_id,
           provider_service_id, provider_key, external_service_id,
           provider_service_type, quantity, input_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${columns}`,
        [businessId, orderId, context.orderItemId, context.productId,
          context.integrationId, context.providerServiceId, context.providerKey,
          context.externalServiceId, context.serviceType, context.quantity, inputData],
      );
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL did not return the created fulfillment");
      return mapFulfillment(row);
    } catch (error) {
      mapUnique(error);
    }
  }

  async findByOrderItem(businessId: string, orderItemId: string): Promise<Fulfillment | null> {
    const result = await this.db.query<FulfillmentRow>(
      `SELECT ${columns} FROM fulfillments
       WHERE business_id = $1 AND order_item_id = $2`,
      [businessId, orderItemId],
    );
    return result.rows[0] ? mapFulfillment(result.rows[0]) : null;
  }

  async findById(businessId: string, fulfillmentId: string): Promise<Fulfillment | null> {
    const result = await this.db.query<FulfillmentRow>(
      `SELECT ${columns} FROM fulfillments WHERE business_id = $1 AND id = $2`,
      [businessId, fulfillmentId],
    );
    return result.rows[0] ? mapFulfillment(result.rows[0]) : null;
  }

  async lockById(
    businessId: string,
    fulfillmentId: string,
    executor: DatabaseExecutor,
  ): Promise<Fulfillment | null> {
    const result = await executor.query<FulfillmentRow>(
      `SELECT ${columns} FROM fulfillments
       WHERE business_id = $1 AND id = $2 FOR UPDATE`,
      [businessId, fulfillmentId],
    );
    return result.rows[0] ? mapFulfillment(result.rows[0]) : null;
  }

  async listByOrder(businessId: string, orderId: string): Promise<Fulfillment[]> {
    const result = await this.db.query<FulfillmentRow>(
      `SELECT ${columns} FROM fulfillments
       WHERE business_id = $1 AND order_id = $2 ORDER BY created_at, id`,
      [businessId, orderId],
    );
    return result.rows.map(mapFulfillment);
  }

  async markSubmitting(
    businessId: string,
    fulfillmentId: string,
    attemptedAt: string,
    executor: DatabaseExecutor,
  ): Promise<Fulfillment | null> {
    const result = await executor.query<FulfillmentRow>(
      `UPDATE fulfillments
       SET status = 'submitting', submission_attempted_at = $3, updated_at = now()
       WHERE business_id = $1 AND id = $2 AND status IN ('pending', 'failed')
       RETURNING ${columns}`,
      [businessId, fulfillmentId, attemptedAt],
    );
    return result.rows[0] ? mapFulfillment(result.rows[0]) : null;
  }

  async markFailed(
    businessId: string,
    fulfillmentId: string,
    executor: DatabaseExecutor,
  ): Promise<Fulfillment | null> {
    return this.transitionSubmission(businessId, fulfillmentId, "failed", executor);
  }

  async markSubmissionUnknown(
    businessId: string,
    fulfillmentId: string,
    executor: DatabaseExecutor,
  ): Promise<Fulfillment | null> {
    return this.transitionSubmission(businessId, fulfillmentId, "submission_unknown", executor);
  }

  async markSubmitted(
    businessId: string,
    fulfillmentId: string,
    providerOrderId: string,
    submittedAt: string,
    executor: DatabaseExecutor,
  ): Promise<Fulfillment | null> {
    try {
      const result = await executor.query<FulfillmentRow>(
        `UPDATE fulfillments
         SET status = 'submitted', provider_order_id = $3, submitted_at = $4,
             updated_at = now()
         WHERE business_id = $1 AND id = $2 AND status = 'submitting'
         RETURNING ${columns}`,
        [businessId, fulfillmentId, providerOrderId, submittedAt],
      );
      return result.rows[0] ? mapFulfillment(result.rows[0]) : null;
    } catch (error) {
      mapUnique(error);
    }
  }

  async transitionOrder(
    businessId: string,
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    executor: DatabaseExecutor,
  ): Promise<boolean> {
    const result = await executor.query(
      `UPDATE orders SET status = $4, updated_at = now()
       WHERE business_id = $1 AND id = $2 AND status = $3`,
      [businessId, orderId, from, to],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async applyProviderStatus(
    businessId: string,
    fulfillmentId: string,
    details: ProviderStatusPersistence,
    executor: DatabaseExecutor,
  ): Promise<Fulfillment | null> {
    const result = await executor.query<FulfillmentRow>(
      `UPDATE fulfillments
       SET provider_status_raw = $3, status = $4, provider_charge = $5,
           provider_currency = $6, provider_remains = $7,
           provider_start_count = $8, last_status_synced_at = $9,
           completed_at = $10, updated_at = now()
       WHERE business_id = $1 AND id = $2
       RETURNING ${columns}`,
      [businessId, fulfillmentId, details.providerStatusRaw, details.status,
        details.providerCharge, details.providerCurrency, details.providerRemains,
        details.providerStartCount, details.lastStatusSyncedAt, details.completedAt],
    );
    return result.rows[0] ? mapFulfillment(result.rows[0]) : null;
  }

  async countNotCompletedByOrder(
    businessId: string,
    orderId: string,
    executor: DatabaseExecutor,
  ): Promise<number> {
    const result = await executor.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM fulfillments
       WHERE business_id = $1 AND order_id = $2 AND status <> 'completed'`,
      [businessId, orderId],
    );
    return result.rows[0]?.count ?? 0;
  }

  private async transitionSubmission(
    businessId: string,
    fulfillmentId: string,
    status: "failed" | "submission_unknown",
    executor: DatabaseExecutor,
  ): Promise<Fulfillment | null> {
    const result = await executor.query<FulfillmentRow>(
      `UPDATE fulfillments SET status = $3, updated_at = now()
       WHERE business_id = $1 AND id = $2 AND status = 'submitting'
       RETURNING ${columns}`,
      [businessId, fulfillmentId, status],
    );
    return result.rows[0] ? mapFulfillment(result.rows[0]) : null;
  }
}
