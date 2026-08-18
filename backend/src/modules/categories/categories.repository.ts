import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import {
  CategoryNameConflictError,
  type CategoriesRepository,
  type Category,
  type CategoryListOptions,
  type CategoryPersistenceInput,
  type CategoryStatus,
} from "./categories.types.js";

interface CategoryRow extends QueryResultRow {
  id: string;
  business_id: string;
  name: string;
  status: CategoryStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PostgreSqlError {
  code?: string;
  constraint?: string;
}

const categoryColumns = "id, business_id, name, status, created_at, updated_at";

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function isNameConflict(error: unknown): boolean {
  const postgresError = error as PostgreSqlError;
  return (
    postgresError.code === "23505" &&
    postgresError.constraint === "categories_business_name_unique_ci"
  );
}

export class PostgresCategoriesRepository implements CategoriesRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async create(businessId: string, input: CategoryPersistenceInput): Promise<Category> {
    try {
      const result = await this.db.query<CategoryRow>(
        `INSERT INTO categories (business_id, name, status)
         VALUES ($1, $2, $3)
         RETURNING ${categoryColumns}`,
        [businessId, input.name, input.status],
      );
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL did not return the created category");
      return mapCategory(row);
    } catch (error) {
      if (isNameConflict(error)) throw new CategoryNameConflictError();
      throw error;
    }
  }

  async list(businessId: string, options: CategoryListOptions): Promise<Category[]> {
    const result = await this.db.query<CategoryRow>(
      `SELECT ${categoryColumns}
       FROM categories
       WHERE business_id = $1
         AND ($2::catalog_status IS NULL OR status = $2)
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [businessId, options.status ?? null, options.limit, options.offset],
    );
    return result.rows.map(mapCategory);
  }

  async findById(businessId: string, categoryId: string): Promise<Category | null> {
    const result = await this.db.query<CategoryRow>(
      `SELECT ${categoryColumns}
       FROM categories
       WHERE business_id = $1 AND id = $2`,
      [businessId, categoryId],
    );
    return result.rows[0] ? mapCategory(result.rows[0]) : null;
  }

  async findByName(
    businessId: string,
    name: string,
    excludeCategoryId?: string,
  ): Promise<Category | null> {
    const result = await this.db.query<CategoryRow>(
      `SELECT ${categoryColumns}
       FROM categories
       WHERE business_id = $1
         AND lower(name) = lower($2)
         AND ($3::uuid IS NULL OR id <> $3)`,
      [businessId, name, excludeCategoryId ?? null],
    );
    return result.rows[0] ? mapCategory(result.rows[0]) : null;
  }

  async update(
    businessId: string,
    categoryId: string,
    input: CategoryPersistenceInput,
  ): Promise<Category | null> {
    try {
      const result = await this.db.query<CategoryRow>(
        `UPDATE categories
         SET name = $3, status = $4, updated_at = now()
         WHERE business_id = $1 AND id = $2
         RETURNING ${categoryColumns}`,
        [businessId, categoryId, input.name, input.status],
      );
      return result.rows[0] ? mapCategory(result.rows[0]) : null;
    } catch (error) {
      if (isNameConflict(error)) throw new CategoryNameConflictError();
      throw error;
    }
  }
}
