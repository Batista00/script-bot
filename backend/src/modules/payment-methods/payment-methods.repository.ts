import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import type { JsonObject } from "../integrations/integrations.types.js";
import {
  type PaymentMethod,
  PaymentMethodConflictError,
  type PaymentMethodPersistenceInput,
  type PaymentMethodsRepository,
  PaymentMethodHistoryConflictError,
  type PaymentMethodStatus,
  type PaymentMethodType,
} from "./payment-methods.types.js";

interface PaymentMethodRow extends QueryResultRow {
  id: string; business_id: string; type: PaymentMethodType; name: string;
  status: PaymentMethodStatus; config: JsonObject;
  created_at: Date | string; updated_at: Date | string;
}

interface PostgreSqlError { code?: string; constraint?: string }
const columns = "id, business_id, type, name, status, config, created_at, updated_at";
const iso = (value: Date | string) =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();
function map(row: PaymentMethodRow): PaymentMethod {
  return {
    id: row.id, businessId: row.business_id, type: row.type, name: row.name,
    status: row.status, config: row.config,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}
function mapConflict(error: unknown): never {
  const value = error as PostgreSqlError;
  if (value.code === "23505") throw new PaymentMethodConflictError();
  throw error;
}

export class PostgresPaymentMethodsRepository implements PaymentMethodsRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async create(
    businessId: string,
    input: PaymentMethodPersistenceInput,
    executor: DatabaseExecutor = this.db,
  ): Promise<PaymentMethod> {
    try {
      const result = await executor.query<PaymentMethodRow>(
        `INSERT INTO business_payment_methods (business_id, type, name, status, config)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${columns}`,
        [businessId, input.type, input.name, input.status, input.config],
      );
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL did not return the payment method");
      return map(row);
    } catch (error) { return mapConflict(error); }
  }

  async list(businessId: string, status?: PaymentMethodStatus): Promise<PaymentMethod[]> {
    const result = await this.db.query<PaymentMethodRow>(
      `SELECT ${columns} FROM business_payment_methods
       WHERE business_id = $1 AND ($2::catalog_status IS NULL OR status = $2)
       ORDER BY created_at DESC, id DESC`,
      [businessId, status ?? null],
    );
    return result.rows.map(map);
  }

  async findById(
    businessId: string,
    paymentMethodId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<PaymentMethod | null> {
    const result = await executor.query<PaymentMethodRow>(
      `SELECT ${columns} FROM business_payment_methods WHERE business_id = $1 AND id = $2`,
      [businessId, paymentMethodId],
    );
    return result.rows[0] ? map(result.rows[0]) : null;
  }

  async update(
    businessId: string,
    paymentMethodId: string,
    input: PaymentMethodPersistenceInput,
  ): Promise<PaymentMethod | null> {
    try {
      const result = await this.db.query<PaymentMethodRow>(
        `UPDATE business_payment_methods SET name = $3, status = $4, config = $5,
           updated_at = now() WHERE business_id = $1 AND id = $2 RETURNING ${columns}`,
        [businessId, paymentMethodId, input.name, input.status, input.config],
      );
      return result.rows[0] ? map(result.rows[0]) : null;
    } catch (error) { return mapConflict(error); }
  }

  async delete(businessId: string, paymentMethodId: string): Promise<boolean> {
    try {
      const result = await this.db.query(
        "DELETE FROM business_payment_methods WHERE business_id = $1 AND id = $2",
        [businessId, paymentMethodId],
      );
      return result.rowCount === 1;
    } catch (error) {
      if ((error as PostgreSqlError).code === "23503") {
        throw new PaymentMethodHistoryConflictError();
      }
      throw error;
    }
  }
}
