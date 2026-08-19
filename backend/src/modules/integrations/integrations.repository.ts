import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import {
  type BusinessIntegrationRecord,
  type IntegrationListOptions,
  type IntegrationPersistenceInput,
  IntegrationProviderConflictError,
  type IntegrationsRepository,
  type IntegrationStatus,
  type JsonObject,
} from "./integrations.types.js";

interface IntegrationRow extends QueryResultRow {
  id: string;
  business_id: string;
  provider_key: string;
  status: IntegrationStatus;
  config: JsonObject;
  credentials_encrypted: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PostgreSqlError { code?: string; constraint?: string }

const integrationColumns = `id, business_id, provider_key, status, config,
  credentials_encrypted, created_at, updated_at`;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapIntegration(row: IntegrationRow): BusinessIntegrationRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    providerKey: row.provider_key,
    status: row.status,
    config: row.config,
    credentialsEncrypted: row.credentials_encrypted,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapConflict(error: unknown): never {
  const postgresError = error as PostgreSqlError;
  if (
    postgresError.code === "23505" &&
    postgresError.constraint === "business_integrations_business_provider_unique"
  ) {
    throw new IntegrationProviderConflictError();
  }
  throw error;
}

export class PostgresIntegrationsRepository implements IntegrationsRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async create(
    businessId: string,
    input: IntegrationPersistenceInput,
  ): Promise<BusinessIntegrationRecord> {
    try {
      const result = await this.db.query<IntegrationRow>(
        `INSERT INTO business_integrations (
           business_id, provider_key, status, config, credentials_encrypted
         ) VALUES ($1, $2, $3, $4, $5)
         RETURNING ${integrationColumns}`,
        [businessId, input.providerKey, input.status, input.config,
          input.credentialsEncrypted],
      );
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL did not return the created integration");
      return mapIntegration(row);
    } catch (error) {
      return mapConflict(error);
    }
  }

  async list(
    businessId: string,
    options: IntegrationListOptions,
  ): Promise<BusinessIntegrationRecord[]> {
    const result = await this.db.query<IntegrationRow>(
      `SELECT ${integrationColumns} FROM business_integrations
       WHERE business_id = $1
         AND ($2::integration_status IS NULL OR status = $2)
         AND ($3::text IS NULL OR provider_key = $3)
       ORDER BY created_at DESC, id DESC LIMIT $4 OFFSET $5`,
      [businessId, options.status ?? null, options.providerKey ?? null,
        options.limit, options.offset],
    );
    return result.rows.map(mapIntegration);
  }

  async findById(
    businessId: string,
    integrationId: string,
  ): Promise<BusinessIntegrationRecord | null> {
    const result = await this.db.query<IntegrationRow>(
      `SELECT ${integrationColumns} FROM business_integrations
       WHERE business_id = $1 AND id = $2`,
      [businessId, integrationId],
    );
    return result.rows[0] ? mapIntegration(result.rows[0]) : null;
  }

  async findByProviderKey(
    businessId: string,
    providerKey: string,
  ): Promise<BusinessIntegrationRecord | null> {
    const result = await this.db.query<IntegrationRow>(
      `SELECT ${integrationColumns} FROM business_integrations
       WHERE business_id = $1 AND provider_key = $2`,
      [businessId, providerKey],
    );
    return result.rows[0] ? mapIntegration(result.rows[0]) : null;
  }

  async findInternalById(integrationId: string): Promise<BusinessIntegrationRecord | null> {
    const result = await this.db.query<IntegrationRow>(
      `SELECT ${integrationColumns} FROM business_integrations WHERE id = $1`,
      [integrationId],
    );
    return result.rows[0] ? mapIntegration(result.rows[0]) : null;
  }

  async update(
    businessId: string,
    integrationId: string,
    input: IntegrationPersistenceInput,
  ): Promise<BusinessIntegrationRecord | null> {
    try {
      const result = await this.db.query<IntegrationRow>(
        `UPDATE business_integrations
         SET status = $3, config = $4, credentials_encrypted = $5, updated_at = now()
         WHERE business_id = $1 AND id = $2
         RETURNING ${integrationColumns}`,
        [businessId, integrationId, input.status, input.config,
          input.credentialsEncrypted],
      );
      return result.rows[0] ? mapIntegration(result.rows[0]) : null;
    } catch (error) {
      return mapConflict(error);
    }
  }
}
