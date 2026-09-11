import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import type { BusinessStatus } from "../businesses/businesses.types.js";
import type { UserStatus } from "../users/users.types.js";
import type {
  BusinessMembership,
  BusinessMembershipsRepository,
  BusinessRole,
  MembershipStatus,
  MembershipUpdateInput,
  MembershipWithBusiness,
  MembershipWithUser,
} from "./memberships.types.js";
import { MembershipAlreadyExistsError } from "./memberships.types.js";

interface MembershipRow extends QueryResultRow {
  id: string;
  business_id: string;
  user_id: string;
  role: BusinessRole;
  status: MembershipStatus;
  business_status: BusinessStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MembershipBusinessRow extends MembershipRow {
  business_name: string;
  business_currency: string;
  business_created_at: Date | string;
  business_updated_at: Date | string;
}

interface MembershipUserRow extends MembershipRow {
  user_email: string;
  user_name: string;
  user_status: UserStatus;
}

interface CountRow extends QueryResultRow {
  count: number;
}

interface PostgreSqlError {
  code?: string;
  constraint?: string;
}

function mapMembershipUniqueError(error: unknown): never {
  const pgError = error as PostgreSqlError;
  if (
    pgError.code === "23505" &&
    pgError.constraint === "business_memberships_business_user_unique"
  ) {
    throw new MembershipAlreadyExistsError();
  }
  throw error;
}

const membershipColumns = `membership.id,
  membership.business_id,
  membership.user_id,
  membership.role,
  membership.status,
  membership.created_at,
  membership.updated_at,
  business.status AS business_status`;

const membershipUserColumns = `${membershipColumns},
  member.email AS user_email,
  member.name AS user_name,
  member.status AS user_status`;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapMembership(row: MembershipRow): BusinessMembership {
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    businessStatus: row.business_status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapMembershipWithUser(row: MembershipUserRow): MembershipWithUser {
  return {
    ...mapMembership(row),
    user: {
      id: row.user_id,
      email: row.user_email,
      name: row.user_name,
      status: row.user_status,
    },
  };
}

export class PostgresMembershipsRepository implements BusinessMembershipsRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async create(
    businessId: string,
    userId: string,
    role: BusinessRole,
    executor = this.db,
  ): Promise<BusinessMembership> {
    try {
      const result = await executor.query<MembershipRow>(
        `INSERT INTO business_memberships (business_id, user_id, role)
         VALUES ($1, $2, $3)
         RETURNING id, business_id, user_id, role, status, created_at, updated_at,
           (SELECT status FROM businesses WHERE id = $1) AS business_status`,
        [businessId, userId, role],
      );
      const row = result.rows[0];

      if (!row) throw new Error("PostgreSQL did not return the created membership");
      return mapMembership(row);
    } catch (error) {
      return mapMembershipUniqueError(error);
    }
  }

  async findByBusinessAndUser(
    businessId: string,
    userId: string,
    executor = this.db,
  ): Promise<BusinessMembership | null> {
    const result = await executor.query<MembershipRow>(
      `SELECT ${membershipColumns}
       FROM business_memberships AS membership
       INNER JOIN businesses AS business ON business.id = membership.business_id
       WHERE membership.business_id = $1
         AND membership.user_id = $2
         AND membership.status = 'active'`,
      [businessId, userId],
    );
    const row = result.rows[0];

    return row ? mapMembership(row) : null;
  }

  async findByBusinessAndUserIncludingInactive(
    businessId: string,
    userId: string,
  ): Promise<MembershipWithUser | null> {
    const result = await this.db.query<MembershipUserRow>(
      `SELECT ${membershipUserColumns}
       FROM business_memberships AS membership
       INNER JOIN businesses AS business ON business.id = membership.business_id
       INNER JOIN users AS member ON member.id = membership.user_id
       WHERE membership.business_id = $1 AND membership.user_id = $2`,
      [businessId, userId],
    );
    const row = result.rows[0];

    return row ? mapMembershipWithUser(row) : null;
  }

  async listForUser(userId: string, executor = this.db): Promise<MembershipWithBusiness[]> {
    const result = await executor.query<MembershipBusinessRow>(
      `SELECT ${membershipColumns},
              business.name AS business_name,
              business.currency AS business_currency,
              business.created_at AS business_created_at,
              business.updated_at AS business_updated_at
       FROM business_memberships AS membership
       INNER JOIN businesses AS business ON business.id = membership.business_id
       WHERE membership.user_id = $1 AND membership.status = 'active'
       ORDER BY business.created_at ASC, business.id ASC`,
      [userId],
    );

    return result.rows.map((row) => ({
      ...mapMembership(row),
      business: {
        id: row.business_id,
        name: row.business_name,
        currency: row.business_currency,
        status: row.business_status,
        createdAt: toIsoString(row.business_created_at),
        updatedAt: toIsoString(row.business_updated_at),
      },
    }));
  }

  async listByBusiness(businessId: string): Promise<MembershipWithUser[]> {
    const result = await this.db.query<MembershipUserRow>(
      `SELECT ${membershipUserColumns}
       FROM business_memberships AS membership
       INNER JOIN businesses AS business ON business.id = membership.business_id
       INNER JOIN users AS member ON member.id = membership.user_id
       WHERE membership.business_id = $1
       ORDER BY membership.created_at ASC, membership.id ASC`,
      [businessId],
    );

    return result.rows.map(mapMembershipWithUser);
  }

  async findById(businessId: string, membershipId: string): Promise<MembershipWithUser | null> {
    const result = await this.db.query<MembershipUserRow>(
      `SELECT ${membershipUserColumns}
       FROM business_memberships AS membership
       INNER JOIN businesses AS business ON business.id = membership.business_id
       INNER JOIN users AS member ON member.id = membership.user_id
       WHERE membership.business_id = $1 AND membership.id = $2`,
      [businessId, membershipId],
    );
    const row = result.rows[0];

    return row ? mapMembershipWithUser(row) : null;
  }

  async update(
    businessId: string,
    membershipId: string,
    input: MembershipUpdateInput,
  ): Promise<MembershipWithUser | null> {
    const result = await this.db.query<MembershipUserRow>(
      `UPDATE business_memberships AS membership
       SET role = $3, status = $4, updated_at = now()
       FROM businesses AS business, users AS member
       WHERE membership.business_id = $1
         AND membership.id = $2
         AND business.id = membership.business_id
         AND member.id = membership.user_id
       RETURNING ${membershipUserColumns}`,
      [businessId, membershipId, input.role, input.status],
    );
    const row = result.rows[0];

    return row ? mapMembershipWithUser(row) : null;
  }

  async delete(businessId: string, membershipId: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM business_memberships WHERE business_id = $1 AND id = $2`,
      [businessId, membershipId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async countActiveOwners(businessId: string): Promise<number> {
    const result = await this.db.query<CountRow>(
      `SELECT count(*)::integer AS count
       FROM business_memberships
       WHERE business_id = $1 AND role = 'owner' AND status = 'active'`,
      [businessId],
    );

    return result.rows[0]?.count ?? 0;
  }
}
