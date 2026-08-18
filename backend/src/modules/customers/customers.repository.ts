import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import {
  CustomerContactConflictError,
  type Customer,
  type CustomerContact,
  type CustomerContactConflict,
  type CustomerListOptions,
  type CustomerPersistenceInput,
  type CustomersRepository,
  type CustomerStatus,
} from "./customers.types.js";

interface CustomerRow extends QueryResultRow {
  id: string;
  business_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: CustomerStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ContactConflictRow extends QueryResultRow {
  conflict: CustomerContactConflict;
}

interface PostgreSqlError {
  code?: string;
  constraint?: string;
}

const customerColumns =
  "id, business_id, name, phone, email, status, created_at, updated_at";

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapContactConflict(error: unknown): CustomerContactConflictError | null {
  const postgresError = error as PostgreSqlError;

  if (postgresError.code !== "23505") return null;
  if (postgresError.constraint === "customers_business_phone_unique") {
    return new CustomerContactConflictError("phone");
  }
  if (postgresError.constraint === "customers_business_email_unique_ci") {
    return new CustomerContactConflictError("email");
  }
  return null;
}

export class PostgresCustomersRepository implements CustomersRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async create(businessId: string, input: CustomerPersistenceInput): Promise<Customer> {
    try {
      const result = await this.db.query<CustomerRow>(
        `INSERT INTO customers (business_id, name, phone, email, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${customerColumns}`,
        [businessId, input.name, input.phone, input.email, input.status],
      );
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL did not return the created customer");
      return mapCustomer(row);
    } catch (error) {
      const conflict = mapContactConflict(error);
      if (conflict) throw conflict;
      throw error;
    }
  }

  async list(businessId: string, options: CustomerListOptions): Promise<Customer[]> {
    const result = await this.db.query<CustomerRow>(
      `SELECT ${customerColumns}
       FROM customers
       WHERE business_id = $1
         AND ($2::text IS NULL OR phone = $2)
         AND ($3::text IS NULL OR email = $3)
       ORDER BY created_at DESC, id DESC
       LIMIT $4 OFFSET $5`,
      [businessId, options.phone ?? null, options.email ?? null, options.limit, options.offset],
    );

    return result.rows.map(mapCustomer);
  }

  async findById(businessId: string, customerId: string): Promise<Customer | null> {
    const result = await this.db.query<CustomerRow>(
      `SELECT ${customerColumns}
       FROM customers
       WHERE business_id = $1 AND id = $2`,
      [businessId, customerId],
    );

    return result.rows[0] ? mapCustomer(result.rows[0]) : null;
  }

  async findContactConflict(
    businessId: string,
    contact: CustomerContact,
    excludeCustomerId?: string,
  ): Promise<CustomerContactConflict | null> {
    const result = await this.db.query<ContactConflictRow>(
      `SELECT conflict
       FROM (
         SELECT 'phone'::text AS conflict, 1 AS priority
         FROM customers
         WHERE business_id = $1
           AND $2::text IS NOT NULL
           AND phone = $2
           AND ($4::uuid IS NULL OR id <> $4)
         UNION ALL
         SELECT 'email'::text AS conflict, 2 AS priority
         FROM customers
         WHERE business_id = $1
           AND $3::text IS NOT NULL
           AND lower(email) = lower($3)
           AND ($4::uuid IS NULL OR id <> $4)
       ) conflicts
       ORDER BY priority
       LIMIT 1`,
      [businessId, contact.phone, contact.email, excludeCustomerId ?? null],
    );

    return result.rows[0]?.conflict ?? null;
  }

  async update(
    businessId: string,
    customerId: string,
    input: CustomerPersistenceInput,
  ): Promise<Customer | null> {
    try {
      const result = await this.db.query<CustomerRow>(
        `UPDATE customers
         SET name = $3,
             phone = $4,
             email = $5,
             status = $6,
             updated_at = now()
         WHERE business_id = $1 AND id = $2
         RETURNING ${customerColumns}`,
        [businessId, customerId, input.name, input.phone, input.email, input.status],
      );

      return result.rows[0] ? mapCustomer(result.rows[0]) : null;
    } catch (error) {
      const conflict = mapContactConflict(error);
      if (conflict) throw conflict;
      throw error;
    }
  }
}
