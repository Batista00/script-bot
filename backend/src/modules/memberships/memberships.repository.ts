import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import type { BusinessStatus } from "../businesses/businesses.types.js";
import type {
  BusinessMembership,
  BusinessRole,
  MembershipsRepository,
  MembershipWithBusiness,
} from "./memberships.types.js";

interface MembershipRow extends QueryResultRow {
  id: string;
  business_id: string;
  user_id: string;
  role: BusinessRole;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MembershipBusinessRow extends MembershipRow {
  business_name: string;
  business_status: BusinessStatus;
  business_created_at: Date | string;
  business_updated_at: Date | string;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapMembership(row: MembershipRow): BusinessMembership {
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    role: row.role,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

export class PostgresMembershipsRepository implements MembershipsRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async create(
    businessId: string,
    userId: string,
    role: BusinessRole,
    executor = this.db,
  ): Promise<BusinessMembership> {
    const result = await executor.query<MembershipRow>(
      `INSERT INTO business_memberships (business_id, user_id, role)
       VALUES ($1, $2, $3)
       RETURNING id, business_id, user_id, role, created_at, updated_at`,
      [businessId, userId, role],
    );
    const row = result.rows[0];

    if (!row) throw new Error("PostgreSQL did not return the created membership");
    return mapMembership(row);
  }

  async findByBusinessAndUser(
    businessId: string,
    userId: string,
    executor = this.db,
  ): Promise<BusinessMembership | null> {
    const result = await executor.query<MembershipRow>(
      `SELECT id, business_id, user_id, role, created_at, updated_at
       FROM business_memberships
       WHERE business_id = $1 AND user_id = $2`,
      [businessId, userId],
    );
    const row = result.rows[0];

    return row ? mapMembership(row) : null;
  }

  async listForUser(userId: string, executor = this.db): Promise<MembershipWithBusiness[]> {
    const result = await executor.query<MembershipBusinessRow>(
      `SELECT membership.id,
              membership.business_id,
              membership.user_id,
              membership.role,
              membership.created_at,
              membership.updated_at,
              business.name AS business_name,
              business.status AS business_status,
              business.created_at AS business_created_at,
              business.updated_at AS business_updated_at
       FROM business_memberships AS membership
       INNER JOIN businesses AS business ON business.id = membership.business_id
       WHERE membership.user_id = $1
       ORDER BY business.created_at ASC, business.id ASC`,
      [userId],
    );

    return result.rows.map((row) => ({
      ...mapMembership(row),
      business: {
        id: row.business_id,
        name: row.business_name,
        status: row.business_status,
        createdAt: toIsoString(row.business_created_at),
        updatedAt: toIsoString(row.business_updated_at),
      },
    }));
  }
}

