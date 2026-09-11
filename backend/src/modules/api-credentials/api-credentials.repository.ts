import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import type { BusinessStatus } from "../businesses/businesses.types.js";
import {
  type ActiveApiCredential,
  type ApiCredential,
  type ApiCredentialsRepository,
  type ApiCredentialStatus,
  ApiCredentialTokenHashConflictError,
} from "./api-credentials.types.js";

interface ApiCredentialRow extends QueryResultRow {
  id: string;
  business_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  status: ApiCredentialStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ActiveApiCredentialRow extends ApiCredentialRow {
  business_status: BusinessStatus;
}

const columns = `id, business_id, name, token_hash, token_prefix, status,
  created_at, updated_at`;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function map(row: ApiCredentialRow): ApiCredential {
  return {
    id: row.id, businessId: row.business_id, name: row.name,
    prefix: row.token_prefix, status: row.status,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

export class PostgresApiCredentialsRepository implements ApiCredentialsRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async create(
    businessId: string,
    input: { name: string; tokenHash: string; prefix: string },
  ): Promise<ApiCredential> {
    try {
      const result = await this.db.query<ApiCredentialRow>(
        `INSERT INTO business_api_credentials
           (business_id, name, token_hash, token_prefix, status)
         VALUES ($1, $2, $3, $4, 'active') RETURNING ${columns}`,
        [businessId, input.name, input.tokenHash, input.prefix],
      );
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL did not return the created API credential");
      return map(row);
    } catch (error) {
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === "23505" &&
          pgError.constraint === "business_api_credentials_token_hash_unique") {
        throw new ApiCredentialTokenHashConflictError();
      }
      throw error;
    }
  }

  async list(businessId: string): Promise<ApiCredential[]> {
    const result = await this.db.query<ApiCredentialRow>(
      `SELECT ${columns} FROM business_api_credentials
       WHERE business_id = $1 ORDER BY created_at DESC, id DESC`,
      [businessId],
    );
    return result.rows.map(map);
  }

  async findById(businessId: string, credentialId: string): Promise<ApiCredential | null> {
    const result = await this.db.query<ApiCredentialRow>(
      `SELECT ${columns} FROM business_api_credentials
       WHERE business_id = $1 AND id = $2`,
      [businessId, credentialId],
    );
    return result.rows[0] ? map(result.rows[0]) : null;
  }

  async findActiveByHash(tokenHash: string): Promise<ActiveApiCredential | null> {
    const result = await this.db.query<ActiveApiCredentialRow>(
      `SELECT credential.id, credential.business_id, credential.name,
              credential.token_hash, credential.token_prefix, credential.status,
              credential.created_at, credential.updated_at,
              business.status AS business_status
       FROM business_api_credentials AS credential
       INNER JOIN businesses AS business ON business.id = credential.business_id
       WHERE credential.token_hash = $1 AND credential.status = 'active'`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row
      ? { ...map(row), tokenHash: row.token_hash, businessStatus: row.business_status }
      : null;
  }

  async update(
    businessId: string,
    credentialId: string,
    input: { name: string; status: ApiCredentialStatus },
  ): Promise<ApiCredential | null> {
    const result = await this.db.query<ApiCredentialRow>(
      `UPDATE business_api_credentials
       SET name = $3, status = $4, updated_at = now()
       WHERE business_id = $1 AND id = $2 RETURNING ${columns}`,
      [businessId, credentialId, input.name, input.status],
    );
    return result.rows[0] ? map(result.rows[0]) : null;
  }
}
