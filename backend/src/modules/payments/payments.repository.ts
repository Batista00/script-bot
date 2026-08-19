import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import type { OrderStatus } from "../orders/orders.types.js";
import {
  type Payment,
  PaymentApprovedUniqueError,
  type PaymentListOptions,
  type PaymentOrderContext,
  type PaymentPersistenceInput,
  type PaymentProviderDetails,
  PaymentIdempotencyUniqueError,
  PaymentProviderIdentityUniqueError,
  PaymentProviderReferenceUniqueError,
  type PaymentsRepository,
  type PaymentStatus,
} from "./payments.types.js";

interface PaymentRow extends QueryResultRow {
  id: string;
  business_id: string;
  order_id: string;
  provider_key: string;
  provider_reference_id: string | null;
  provider_payment_id: string | null;
  status: PaymentStatus;
  amount: string | number;
  currency: string;
  checkout_url: string | null;
  idempotency_key: string | null;
  expires_at: Date | string | null;
  approved_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PaymentOrderRow extends QueryResultRow {
  id: string;
  business_id: string;
  status: OrderStatus;
  total: string | number;
  currency: string;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
}

interface PostgreSqlError { code?: string; constraint?: string }

const paymentColumns = `id, business_id, order_id, provider_key, provider_reference_id,
  provider_payment_id,
  status, amount, currency, checkout_url, idempotency_key, expires_at, approved_at,
  created_at, updated_at`;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapMoney(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(BigInt(value));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("PostgreSQL returned money outside the safe API range");
  }
  return parsed;
}

function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    businessId: row.business_id,
    orderId: row.order_id,
    providerKey: row.provider_key,
    providerReferenceId: row.provider_reference_id,
    providerPaymentId: row.provider_payment_id,
    status: row.status,
    amount: mapMoney(row.amount),
    currency: row.currency,
    checkoutUrl: row.checkout_url,
    idempotencyKey: row.idempotency_key,
    expiresAt: row.expires_at === null ? null : toIsoString(row.expires_at),
    approvedAt: row.approved_at === null ? null : toIsoString(row.approved_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapUniqueError(error: unknown): never {
  const pgError = error as PostgreSqlError;
  if (pgError.code === "23505") {
    if (pgError.constraint === "payments_business_idempotency_unique") {
      throw new PaymentIdempotencyUniqueError();
    }
    if (pgError.constraint === "payments_provider_identity_unique") {
      throw new PaymentProviderIdentityUniqueError();
    }
    if (pgError.constraint === "payments_provider_reference_unique") {
      throw new PaymentProviderReferenceUniqueError();
    }
    if (pgError.constraint === "payments_approved_order_unique") {
      throw new PaymentApprovedUniqueError();
    }
  }
  throw error;
}

export class PostgresPaymentsRepository implements PaymentsRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async create(
    businessId: string,
    input: PaymentPersistenceInput,
    executor: DatabaseExecutor,
  ): Promise<Payment> {
    try {
      const result = await executor.query<PaymentRow>(
        `INSERT INTO payments (
           business_id, order_id, provider_key, amount, currency, idempotency_key
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${paymentColumns}`,
        [businessId, input.orderId, input.providerKey, input.amount, input.currency,
          input.idempotencyKey],
      );
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL did not return the created payment");
      return mapPayment(row);
    } catch (error) {
      return mapUniqueError(error);
    }
  }

  async findOrderForPayment(
    businessId: string,
    orderId: string,
    executor: DatabaseExecutor,
  ): Promise<PaymentOrderContext | null> {
    const result = await executor.query<PaymentOrderRow>(
      `SELECT o.id, o.business_id, o.status, o.total, o.currency,
              c.id AS customer_id, c.name AS customer_name,
              c.phone AS customer_phone, c.email AS customer_email
       FROM orders o
       JOIN customers c
         ON c.business_id = o.business_id AND c.id = o.customer_id
       WHERE o.business_id = $1 AND o.id = $2
       FOR UPDATE OF o`,
      [businessId, orderId],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      businessId: row.business_id,
      status: row.status,
      total: mapMoney(row.total),
      currency: row.currency,
      customer: {
        id: row.customer_id,
        name: row.customer_name,
        phone: row.customer_phone,
        email: row.customer_email,
      },
    } : null;
  }

  async findByIdempotencyKey(
    businessId: string,
    idempotencyKey: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<Payment | null> {
    const result = await executor.query<PaymentRow>(
      `SELECT ${paymentColumns} FROM payments
       WHERE business_id = $1 AND idempotency_key = $2`,
      [businessId, idempotencyKey],
    );
    return result.rows[0] ? mapPayment(result.rows[0]) : null;
  }

  async findByProviderIdentity(
    businessId: string,
    providerKey: string,
    providerPaymentId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<Payment | null> {
    const result = await executor.query<PaymentRow>(
      `SELECT ${paymentColumns} FROM payments
       WHERE business_id = $1 AND provider_key = $2 AND provider_payment_id = $3`,
      [businessId, providerKey, providerPaymentId],
    );
    return result.rows[0] ? mapPayment(result.rows[0]) : null;
  }

  async lockById(
    businessId: string,
    paymentId: string,
    executor: DatabaseExecutor,
  ): Promise<Payment | null> {
    const result = await executor.query<PaymentRow>(
      `SELECT ${paymentColumns} FROM payments
       WHERE business_id = $1 AND id = $2 FOR UPDATE`,
      [businessId, paymentId],
    );
    return result.rows[0] ? mapPayment(result.rows[0]) : null;
  }

  async findApprovedByOrder(
    businessId: string,
    orderId: string,
    executor: DatabaseExecutor,
  ): Promise<Payment | null> {
    const result = await executor.query<PaymentRow>(
      `SELECT ${paymentColumns} FROM payments
       WHERE business_id = $1 AND order_id = $2 AND status = 'approved'
       LIMIT 1`,
      [businessId, orderId],
    );
    return result.rows[0] ? mapPayment(result.rows[0]) : null;
  }

  async updatePendingDetails(
    businessId: string,
    paymentId: string,
    details: PaymentProviderDetails,
    executor: DatabaseExecutor,
  ): Promise<Payment | null> {
    try {
      const result = await executor.query<PaymentRow>(
        `UPDATE payments
         SET provider_reference_id = $3, provider_payment_id = $4,
             checkout_url = $5, expires_at = $6,
             updated_at = now()
         WHERE business_id = $1 AND id = $2 AND status = 'pending'
         RETURNING ${paymentColumns}`,
        [businessId, paymentId, details.providerReferenceId,
          details.providerPaymentId, details.checkoutUrl, details.expiresAt],
      );
      return result.rows[0] ? mapPayment(result.rows[0]) : null;
    } catch (error) {
      return mapUniqueError(error);
    }
  }

  async transitionPending(
    businessId: string,
    paymentId: string,
    status: Exclude<PaymentStatus, "pending">,
    details: PaymentProviderDetails,
    approvedAt: string | null,
    executor: DatabaseExecutor,
  ): Promise<Payment | null> {
    try {
      const result = await executor.query<PaymentRow>(
        `UPDATE payments
         SET status = $3, provider_reference_id = $4, provider_payment_id = $5,
             checkout_url = $6, expires_at = $7, approved_at = $8, updated_at = now()
         WHERE business_id = $1 AND id = $2 AND status = 'pending'
         RETURNING ${paymentColumns}`,
        [businessId, paymentId, status, details.providerReferenceId,
          details.providerPaymentId, details.checkoutUrl, details.expiresAt, approvedAt],
      );
      return result.rows[0] ? mapPayment(result.rows[0]) : null;
    } catch (error) {
      return mapUniqueError(error);
    }
  }

  async markOrderPaid(
    businessId: string,
    orderId: string,
    executor: DatabaseExecutor,
  ): Promise<boolean> {
    const result = await executor.query<{ id: string }>(
      `UPDATE orders SET status = 'paid', updated_at = now()
       WHERE business_id = $1 AND id = $2 AND status = 'pending_payment'
       RETURNING id`,
      [businessId, orderId],
    );
    return result.rows[0] !== undefined;
  }

  async list(businessId: string, options: PaymentListOptions): Promise<Payment[]> {
    const result = await this.db.query<PaymentRow>(
      `SELECT ${paymentColumns} FROM payments
       WHERE business_id = $1
         AND ($2::payment_status IS NULL OR status = $2)
         AND ($3::uuid IS NULL OR order_id = $3)
         AND ($4::text IS NULL OR provider_key = $4)
       ORDER BY created_at DESC, id DESC LIMIT $5 OFFSET $6`,
      [businessId, options.status ?? null, options.orderId ?? null,
        options.providerKey ?? null, options.limit, options.offset],
    );
    return result.rows.map(mapPayment);
  }

  async listByOrder(
    businessId: string,
    orderId: string,
    options: Pick<PaymentListOptions, "limit" | "offset">,
  ): Promise<Payment[]> {
    const result = await this.db.query<PaymentRow>(
      `SELECT ${paymentColumns} FROM payments
       WHERE business_id = $1 AND order_id = $2
       ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
      [businessId, orderId, options.limit, options.offset],
    );
    return result.rows.map(mapPayment);
  }

  async findById(businessId: string, paymentId: string): Promise<Payment | null> {
    const result = await this.db.query<PaymentRow>(
      `SELECT ${paymentColumns} FROM payments WHERE business_id = $1 AND id = $2`,
      [businessId, paymentId],
    );
    return result.rows[0] ? mapPayment(result.rows[0]) : null;
  }
}
