import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import type { User, UserStatus } from "../users/users.types.js";
import type { AuthSessionsRepository } from "./auth.types.js";

interface SessionUserRow extends QueryResultRow {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class PostgresAuthSessionsRepository implements AuthSessionsRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async create(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    executor = this.db,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt],
    );
  }

  async findActiveUserByTokenHash(tokenHash: string): Promise<User | null> {
    const result = await this.db.query<SessionUserRow>(
      `SELECT users.id,
              users.email,
              users.name,
              users.status,
              users.created_at,
              users.updated_at
       FROM auth_sessions
       INNER JOIN users ON users.id = auth_sessions.user_id
       WHERE auth_sessions.token_hash = $1
         AND auth_sessions.expires_at > now()
         AND users.status = 'active'`,
      [tokenHash],
    );
    const row = result.rows[0];

    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      status: row.status,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
    };
  }

  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.db.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash]);
  }
}

