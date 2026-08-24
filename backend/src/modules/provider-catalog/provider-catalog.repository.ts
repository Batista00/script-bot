import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../core/database/database.js";
import type { JsonObject } from "../integrations/integrations.types.js";
import {
  ActiveProductMappingConflictError,
  type NormalizedProviderService,
  type ProductProviderMapping,
  type ProviderCatalogState,
  type ProviderCatalogRepository,
  type ProviderMappingStatus,
  type ProviderService,
  type ProviderServiceListOptions,
  type ProviderServiceStatus,
  type ProviderOrderCapabilities,
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
  provider_description: string | null;
  order_capabilities: ProviderOrderCapabilities;
  provider_status: ProviderServiceStatus;
  mapping_count: number;
  metadata: JsonObject;
  last_synced_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProviderCatalogStateRow extends QueryResultRow {
  business_id: string;
  integration_id: string;
  connection_status: "unknown" | "ok" | "error";
  provider_balance: string | null;
  provider_currency: string | null;
  services_received: number;
  services_normalized: number;
  services_rejected: number;
  rejection_reasons: Record<string, number>;
  last_sync_at: Date | string | null;
  last_balance_at: Date | string | null;
  last_error_code: string | null;
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
  min_quantity, max_quantity, provider_description, order_capabilities,
  provider_status, metadata, last_synced_at, created_at, updated_at`;
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
    providerDescription: row.provider_description,
    orderCapabilities: row.order_capabilities,
    providerStatus: row.provider_status,
    mappingCount: row.mapping_count ?? 0,
    metadata: row.metadata,
    lastSyncedAt: toIsoString(row.last_synced_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIsoString(value);
}

function mapCatalogState(row: ProviderCatalogStateRow): ProviderCatalogState {
  return {
    businessId: row.business_id,
    integrationId: row.integration_id,
    connectionStatus: row.connection_status,
    providerBalance: row.provider_balance,
    providerCurrency: row.provider_currency,
    servicesReceived: row.services_received,
    servicesNormalized: row.services_normalized,
    servicesRejected: row.services_rejected,
    rejectionReasons: row.rejection_reasons,
    lastSyncAt: nullableIso(row.last_sync_at),
    lastBalanceAt: nullableIso(row.last_balance_at),
    lastErrorCode: row.last_error_code,
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
      `SELECT ps.${serviceColumns.replaceAll(", ", ", ps.")},
              (SELECT count(*)::integer FROM product_provider_mappings ppm
               WHERE ppm.business_id = ps.business_id
                 AND ppm.provider_service_id = ps.id
                 AND ppm.id = (
                   SELECT current_ppm.id FROM product_provider_mappings current_ppm
                   WHERE current_ppm.business_id = ppm.business_id
                     AND current_ppm.product_id = ppm.product_id
                   ORDER BY current_ppm.created_at DESC, current_ppm.id DESC
                   LIMIT 1
                 )) AS mapping_count
       FROM provider_services ps
       WHERE ps.business_id = $1
         AND ($2::uuid IS NULL OR ps.integration_id = $2)
         AND ($3::text IS NULL OR ps.provider_key = $3)
         AND ($4::provider_service_status IS NULL OR ps.provider_status = $4)
         AND ($5::text IS NULL OR ps.category = $5)
         AND ($6::text IS NULL OR ps.external_service_id = $6)
         AND ($7::text IS NULL OR ps.service_type = $7)
         AND ($8::text IS NULL OR ps.external_service_id ILIKE $8 ESCAPE '\\'
           OR ps.name ILIKE $8 ESCAPE '\\' OR ps.category ILIKE $8 ESCAPE '\\')
         AND ($9::text IS NULL OR
           ($9 = 'mapped' AND EXISTS (
             SELECT 1 FROM product_provider_mappings ppm
             WHERE ppm.business_id = ps.business_id
               AND ppm.provider_service_id = ps.id
               AND ppm.id = (
                 SELECT current_ppm.id FROM product_provider_mappings current_ppm
                 WHERE current_ppm.business_id = ppm.business_id
                   AND current_ppm.product_id = ppm.product_id
                 ORDER BY current_ppm.created_at DESC, current_ppm.id DESC
                 LIMIT 1
               )
           )) OR
           ($9 = 'unmapped' AND NOT EXISTS (
             SELECT 1 FROM product_provider_mappings ppm
             WHERE ppm.business_id = ps.business_id
               AND ppm.provider_service_id = ps.id
               AND ppm.id = (
                 SELECT current_ppm.id FROM product_provider_mappings current_ppm
                 WHERE current_ppm.business_id = ppm.business_id
                   AND current_ppm.product_id = ppm.product_id
                 ORDER BY current_ppm.created_at DESC, current_ppm.id DESC
                 LIMIT 1
               )
           )))
       ORDER BY ps.created_at DESC, ps.id DESC
       LIMIT $10 OFFSET $11`,
      [businessId, options.integrationId ?? null, options.providerKey ?? null,
        options.providerStatus ?? null, options.category ?? null,
        options.externalServiceId ?? null, options.serviceType ?? null,
        options.search ?? null, options.mappingStatus ?? null,
        options.limit, options.offset],
    );
    return result.rows.map(mapService);
  }

  async findServiceById(
    businessId: string,
    providerServiceId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<ProviderService | null> {
    const result = await executor.query<ProviderServiceRow>(
      `SELECT ${serviceColumns} FROM provider_services
       WHERE business_id = $1 AND id = $2`,
      [businessId, providerServiceId],
    );
    return result.rows[0] ? mapService(result.rows[0]) : null;
  }

  async listServiceIdentities(
    businessId: string,
    integrationId: string,
    executor: DatabaseExecutor,
  ): Promise<Array<{ externalServiceId: string; providerStatus: ProviderServiceStatus }>> {
    const result = await executor.query<{
      external_service_id: string; provider_status: ProviderServiceStatus;
    }>(
      `SELECT external_service_id, provider_status FROM provider_services
       WHERE business_id = $1 AND integration_id = $2`,
      [businessId, integrationId],
    );
    return result.rows.map((row) => ({
      externalServiceId: row.external_service_id,
      providerStatus: row.provider_status,
    }));
  }

  async lockActiveIntegration(
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
      provider_description: service.providerDescription ?? null,
      order_capabilities: service.orderCapabilities ?? {
        supported: false, required: [], optional: [], source: "unverified",
      },
      metadata: service.metadata,
    }));
    await executor.query(
      `INSERT INTO provider_services (
         business_id, integration_id, provider_key, external_service_id, name,
         category, service_type, rate, rate_currency, min_quantity, max_quantity,
         provider_description, order_capabilities, provider_status, metadata, last_synced_at
       )
       SELECT $1, $2, $3, service.external_service_id, service.name,
         service.category, service.service_type, service.rate::numeric,
         service.rate_currency, service.min_quantity, service.max_quantity,
         service.provider_description, service.order_capabilities, 'active', service.metadata,
         $5::timestamptz
       FROM jsonb_to_recordset($4::jsonb) AS service(
         external_service_id text, name text, category text, service_type text,
         rate text, rate_currency text, min_quantity integer, max_quantity integer,
         provider_description text, order_capabilities jsonb, metadata jsonb
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
         provider_description = EXCLUDED.provider_description,
         order_capabilities = EXCLUDED.order_capabilities,
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

  async saveCatalogState(
    businessId: string,
    integrationId: string,
    input: Omit<ProviderCatalogState, "businessId" | "integrationId" | "updatedAt">,
    executor: DatabaseExecutor,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO provider_catalog_states (
         business_id, integration_id, connection_status, provider_balance,
         provider_currency, services_received, services_normalized,
         services_rejected, rejection_reasons, last_sync_at, last_balance_at,
         last_error_code
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (integration_id) DO UPDATE SET
         connection_status = EXCLUDED.connection_status,
         provider_balance = EXCLUDED.provider_balance,
         provider_currency = EXCLUDED.provider_currency,
         services_received = EXCLUDED.services_received,
         services_normalized = EXCLUDED.services_normalized,
         services_rejected = EXCLUDED.services_rejected,
         rejection_reasons = EXCLUDED.rejection_reasons,
         last_sync_at = EXCLUDED.last_sync_at,
         last_balance_at = EXCLUDED.last_balance_at,
         last_error_code = EXCLUDED.last_error_code,
         updated_at = now()`,
      [businessId, integrationId, input.connectionStatus, input.providerBalance,
        input.providerCurrency, input.servicesReceived, input.servicesNormalized,
        input.servicesRejected, JSON.stringify(input.rejectionReasons), input.lastSyncAt,
        input.lastBalanceAt, input.lastErrorCode],
    );
  }

  async findCatalogState(
    businessId: string,
    integrationId: string,
  ): Promise<ProviderCatalogState | null> {
    const result = await this.db.query<ProviderCatalogStateRow>(
      `SELECT business_id, integration_id, connection_status, provider_balance,
              provider_currency, services_received, services_normalized,
              services_rejected, rejection_reasons, last_sync_at, last_balance_at,
              last_error_code, updated_at
       FROM provider_catalog_states
       WHERE business_id = $1 AND integration_id = $2`,
      [businessId, integrationId],
    );
    return result.rows[0] ? mapCatalogState(result.rows[0]) : null;
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
