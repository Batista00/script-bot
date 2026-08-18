import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";

import type {
  Business,
  BusinessesRepository,
  BusinessStatus,
  UpdateBusinessInput,
} from "./businesses.types.js";

interface BusinessRow extends QueryResultRow {
  id: string;
  name: string;
  status: BusinessStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapBusiness(row: BusinessRow): Business {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

const returningColumns = "id, name, status, created_at, updated_at";

export class PostgresBusinessesRepository implements BusinessesRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async create(name: string, executor: DatabaseExecutor = this.db): Promise<Business> {
    const result = await executor.query<BusinessRow>(
      `INSERT INTO businesses (name)
       VALUES ($1)
       RETURNING ${returningColumns}`,
      [name],
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error("PostgreSQL did not return the created business");
    }

    return mapBusiness(row);
  }

  async listForUser(
    userId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<Business[]> {
    const result = await executor.query<BusinessRow>(
      `SELECT b.id, b.name, b.status, b.created_at, b.updated_at
       FROM businesses b
       INNER JOIN business_memberships bm ON bm.business_id = b.id
       WHERE bm.user_id = $1
       ORDER BY b.created_at ASC, b.id ASC`,
      [userId],
    );

    return result.rows.map(mapBusiness);
  }

  async findById(
    id: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<Business | null> {
    const result = await executor.query<BusinessRow>(
      `SELECT ${returningColumns}
       FROM businesses
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];

    return row ? mapBusiness(row) : null;
  }

  async update(
    id: string,
    input: UpdateBusinessInput,
    executor: DatabaseExecutor = this.db,
  ): Promise<Business | null> {
    const result = await executor.query<BusinessRow>(
      `UPDATE businesses
       SET name = COALESCE($2, name),
           status = COALESCE($3::business_status, status),
           updated_at = now()
       WHERE id = $1
       RETURNING ${returningColumns}`,
      [id, input.name ?? null, input.status ?? null],
    );
    const row = result.rows[0];

    return row ? mapBusiness(row) : null;
  }
}
