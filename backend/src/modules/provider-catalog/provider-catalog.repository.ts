import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import type { JsonObject } from "../integrations/integrations.types.js";
import {
  ActiveProductMappingConflictError,
  type NormalizedProviderService,
  type ProductProviderMapping,
  type ProviderCatalogRepository,
  type ProviderMappingStatus,
  type ProviderService,
  type ProviderServiceListOptions,
  type ProviderServiceStatus,
} from "./provider-catalog.types.js";

interface ProviderServiceRow extends QueryResultRow {
  id: string;
  business_id: string;
  integration_id: string;
  provider_key: string;
  external_service_id: string;
  name: string;
  category: string | null;
  service_type: string | null;
  rate: string | null;
  rate_currency: string | null;
  min_quantity: number | null;
  max_quantity: number | null;
  provider_status: ProviderServiceStatus;
  metadata: JsonObject;
  last_synced_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MappingRow extends QueryResultRow {
  id: string;
  business_id: string;
  product_id: string;
  provider_service_id: string;
  status: ProviderMappingStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PostgreSqlError { code?: string; constraint?: string }

const serviceColumns = `id, business_id, integration_id, provider_key,
  external_service_id, name, category, service_type, rate, rate_currency,
  min_quantity, max_quantity, provider_status, metadata, last_synced_at,
  created_at, updated_at`;
const mappingColumns = `id, business_id, product_id, provider_service_id,
  status, created_at, updated_at`;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapService(row: ProviderServiceRow): ProviderService {
  return {
    id: row.id,
    businessId: row.business_id,
    integrationId: row.integration_id,
    providerKey: row.provider_key,
    externalServiceId: row.external_service_id,
    name: row.name,
    category: row.category,
    serviceType: row.service_type,
    rate: row.rate,
    rateCurrency: row.rate_currency,
    minQuantity: row.min_quantity,
    maxQuantity: row.max_quantity,
    providerStatus: row.provider_status,
    metadata: row.metadata,
    lastSyncedAt: toIsoString(row.last_synced_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapMapping(row: MappingRow): ProductProviderMapping {
  return {
    id: row.id,
    businessId: row.business_id,
    productId: row.product_id,
    providerServiceId: row.provider_service_id,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapMappingError(error: unknown): never {
  const postgresError = error as PostgreSqlError;
  if (
    postgresError.code === "23505" &&
    postgresError.constraint === "product_provider_mappings_active_product_unique"
  ) {
    throw new ActiveProductMappingConflictError();
  }
  throw error;
}

export class PostgresProviderCatalogRepository implements ProviderCatalogRepository {
  constructor(private readonly db: DatabaseExecutor) {}

  async listServices(
    businessId: string,
    options: ProviderServiceListOptions,
  ): Promise<ProviderService[]> {
    const result = await this.db.query<ProviderServiceRow>(
      `SELECT ${serviceColumns}
       FROM provider_services
       WHERE business_id = $1
         AND ($2::uuid IS NULL OR integration_id = $2)
         AND ($3::text IS NULL OR provider_key = $3)
         AND ($4::provider_service_status IS NULL OR provider_status = $4)
         AND ($5::text IS NULL OR category = $5)
       ORDER BY created_at DESC, id DESC
       LIMIT $6 OFFSET $7`,
      [businessId, options.integrationId ?? null, options.providerKey ?? null,
        options.providerStatus ?? null, options.category ?? null,
        options.limit, options.offset],
    );
    return result.rows.map(mapService);
  }

  async findServiceById(
    businessId: string,
    providerServiceId: string,
  ): Promise<ProviderService | null> {
    const result = await this.db.query<ProviderServiceRow>(
      `SELECT ${serviceColumns} FROM provider_services
       WHERE business_id = $1 AND id = $2`,
      [businessId, providerServiceId],
    );
    return result.rows[0] ? mapService(result.rows[0]) : null;
  }

  async listExternalServiceIds(
    businessId: string,
    integrationId: string,
    executor: DatabaseExecutor,
  ): Promise<string[]> {
    const result = await executor.query<{ external_service_id: string }>(
      `SELECT external_service_id FROM provider_services
       WHERE business_id = $1 AND integration_id = $2`,
      [businessId, integrationId],
    );
    return result.rows.map((row) => row.external_service_id);
  }

  async lockActiveIntegrationForSync(
    businessId: string,
    integrationId: string,
    executor: DatabaseExecutor,
  ): Promise<boolean> {
    const result = await executor.query(
      `SELECT id FROM business_integrations
       WHERE business_id = $1 AND id = $2 AND status = 'active' FOR UPDATE`,
      [businessId, integrationId],
    );
    return result.rows.length > 0;
  }

  async upsertServices(
    businessId: string,
    integrationId: string,
    providerKey: string,
    services: readonly NormalizedProviderService[],
    syncedAt: string,
    executor: DatabaseExecutor,
  ): Promise<void> {
    if (services.length === 0) return;
    const persistencePayload = services.map((service) => ({
      external_service_id: service.externalServiceId,
      name: service.name,
      category: service.category,
      service_type: service.serviceType,
      rate: service.rate,
      rate_currency: service.rateCurrency,
      min_quantity: service.minQuantity,
      max_quantity: service.maxQuantity,
      metadata: service.metadata,
    }));
    await executor.query(
      `INSERT INTO provider_services (
         business_id, integration_id, provider_key, external_service_id, name,
         category, service_type, rate, rate_currency, min_quantity, max_quantity,
         provider_status, metadata, last_synced_at
       )
       SELECT $1, $2, $3, service.external_service_id, service.name,
         service.category, service.service_type, service.rate::numeric,
         service.rate_currency, service.min_quantity, service.max_quantity,
         'active', service.metadata, $5::timestamptz
       FROM jsonb_to_recordset($4::jsonb) AS service(
         external_service_id text, name text, category text, service_type text,
         rate text, rate_currency text, min_quantity integer, max_quantity integer,
         metadata jsonb
       )
       ON CONFLICT (integration_id, external_service_id) DO UPDATE SET
         provider_key = EXCLUDED.provider_key,
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         service_type = EXCLUDED.service_type,
         rate = EXCLUDED.rate,
         rate_currency = EXCLUDED.rate_currency,
         min_quantity = EXCLUDED.min_quantity,
         max_quantity = EXCLUDED.max_quantity,
         provider_status = 'active',
         metadata = EXCLUDED.metadata,
         last_synced_at = EXCLUDED.last_synced_at,
         updated_at = now()`,
      [businessId, integrationId, providerKey, JSON.stringify(persistencePayload), syncedAt],
    );
  }

  async deactivateMissingServices(
    businessId: string,
    integrationId: string,
    receivedExternalIds: readonly string[],
    syncedAt: string,
    executor: DatabaseExecutor,
  ): Promise<number> {
    const result = await executor.query(
      `UPDATE provider_services
       SET provider_status = 'inactive', last_synced_at = $4, updated_at = now()
       WHERE business_id = $1 AND integration_id = $2
         AND provider_status = 'active'
         AND NOT (external_service_id = ANY($3::text[]))`,
      [businessId, integrationId, [...receivedExternalIds], syncedAt],
    );
    return result.rowCount ?? 0;
  }

  async findCurrentMapping(
    businessId: string,
    productId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<ProductProviderMapping | null> {
    const result = await executor.query<MappingRow>(
      `SELECT ${mappingColumns} FROM product_provider_mappings
       WHERE business_id = $1 AND product_id = $2
       ORDER BY (status = 'active') DESC, updated_at DESC, id DESC
       LIMIT 1`,
      [businessId, productId],
    );
    return result.rows[0] ? mapMapping(result.rows[0]) : null;
  }

  async createMapping(
    businessId: string,
    productId: string,
    providerServiceId: string,
    status: ProviderMappingStatus,
    executor: DatabaseExecutor = this.db,
  ): Promise<ProductProviderMapping> {
    try {
      const result = await executor.query<MappingRow>(
        `INSERT INTO product_provider_mappings (
           business_id, product_id, provider_service_id, status
         ) VALUES ($1, $2, $3, $4)
         RETURNING ${mappingColumns}`,
        [businessId, productId, providerServiceId, status],
      );
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL did not return the created provider mapping");
      return mapMapping(row);
    } catch (error) {
      mapMappingError(error);
    }
  }

  async updateMappingStatus(
    businessId: string,
    mappingId: string,
    status: ProviderMappingStatus,
    executor: DatabaseExecutor = this.db,
  ): Promise<ProductProviderMapping | null> {
    try {
      const result = await executor.query<MappingRow>(
        `UPDATE product_provider_mappings
         SET status = $3, updated_at = now()
         WHERE business_id = $1 AND id = $2
         RETURNING ${mappingColumns}`,
        [businessId, mappingId, status],
      );
      return result.rows[0] ? mapMapping(result.rows[0]) : null;
    } catch (error) {
      mapMappingError(error);
    }
  }
}
