import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import type {
  CreateUserInput,
  User,
  UsersRepository,
  UserStatus,
  UserWithPasswordHash,
} from "./users.types.js";

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  status: UserStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapUserWithPassword(row: UserRow): UserWithPasswordHash {
  return { ...mapUser(row), passwordHash: row.password_hash };
}

const userColumns = "id, email, name, password_hash, status, created_at, updated_at";

export class PostgresUsersRepository implements UsersRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async create(input: CreateUserInput, executor = this.db): Promise<User> {
    const result = await executor.query<UserRow>(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING ${userColumns}`,
      [input.email, input.name, input.passwordHash],
    );
    const row = result.rows[0];

    if (!row) throw new Error("PostgreSQL did not return the created user");
    return mapUser(row);
  }

  async findByEmail(email: string, executor = this.db): Promise<UserWithPasswordHash | null> {
    const result = await executor.query<UserRow>(
      `SELECT ${userColumns}
       FROM users
       WHERE lower(email) = lower($1)`,
      [email],
    );
    const row = result.rows[0];

    return row ? mapUserWithPassword(row) : null;
  }
}

