import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";

export interface OrderToFulfill {
  businessId: string;
  orderId: string;
}

export interface FulfillmentToSync {
  businessId: string;
  fulfillmentId: string;
}

export interface PaymentToReconcile {
  businessId: string;
  paymentId: string;
}

export interface JobSweepsRepository {
  /** Paid orders whose items carry fulfillment input and still have no fulfillment. */
  listOrdersAwaitingFulfillment(limit: number): Promise<OrderToFulfill[]>;
  /** Non-terminal provider orders that deserve a status refresh. */
  listFulfillmentsToSync(limit: number): Promise<FulfillmentToSync[]>;
  /** Pending provider payments already linked to an external payment id. */
  listPaymentsToReconcile(limit: number): Promise<PaymentToReconcile[]>;
}

interface BusinessRow extends QueryResultRow { business_id: string }
interface OrderRow extends BusinessRow { order_id: string }
interface FulfillmentRow extends BusinessRow { fulfillment_id: string }
interface PaymentRow extends BusinessRow { payment_id: string }

export class PostgresJobSweepsRepository implements JobSweepsRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async listOrdersAwaitingFulfillment(limit: number): Promise<OrderToFulfill[]> {
    const result = await this.db.query<OrderRow>(
      `SELECT orders.business_id, orders.id AS order_id
       FROM orders
       JOIN order_items
         ON order_items.business_id = orders.business_id
        AND order_items.order_id = orders.id
       LEFT JOIN fulfillments
         ON fulfillments.business_id = order_items.business_id
        AND fulfillments.order_item_id = order_items.id
       WHERE orders.status IN ('paid', 'processing')
         AND order_items.fulfillment_input <> '{}'::jsonb
         AND fulfillments.id IS NULL
         AND orders.updated_at < now() - interval '1 minute'
       GROUP BY orders.business_id, orders.id, orders.updated_at
       ORDER BY orders.updated_at ASC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({ businessId: row.business_id, orderId: row.order_id }));
  }

  async listFulfillmentsToSync(limit: number): Promise<FulfillmentToSync[]> {
    const result = await this.db.query<FulfillmentRow>(
      `SELECT business_id, id AS fulfillment_id
       FROM fulfillments
       WHERE status IN ('submitted', 'in_progress')
         AND provider_order_id IS NOT NULL
       ORDER BY COALESCE(last_status_synced_at, submitted_at, created_at) ASC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      businessId: row.business_id,
      fulfillmentId: row.fulfillment_id,
    }));
  }

  async listPaymentsToReconcile(limit: number): Promise<PaymentToReconcile[]> {
    const result = await this.db.query<PaymentRow>(
      `SELECT business_id, id AS payment_id
       FROM payments
       WHERE status = 'pending'
         AND provider_payment_id IS NOT NULL
         AND provider_key <> 'bank_transfer'
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({ businessId: row.business_id, paymentId: row.payment_id }));
  }
}
