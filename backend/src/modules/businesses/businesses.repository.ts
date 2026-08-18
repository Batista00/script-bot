import type { Pool, QueryResultRow } from "pg";

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
  constructor(private readonly db: Pool) {}

  async create(name: string): Promise<Business> {
    const result = await this.db.query<BusinessRow>(
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

  async list(): Promise<Business[]> {
    const result = await this.db.query<BusinessRow>(
      `SELECT ${returningColumns}
       FROM businesses
       ORDER BY created_at ASC, id ASC`,
    );

    return result.rows.map(mapBusiness);
  }

  async findById(id: string): Promise<Business | null> {
    const result = await this.db.query<BusinessRow>(
      `SELECT ${returningColumns}
       FROM businesses
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];

    return row ? mapBusiness(row) : null;
  }

  async update(id: string, input: UpdateBusinessInput): Promise<Business | null> {
    const result = await this.db.query<BusinessRow>(
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

