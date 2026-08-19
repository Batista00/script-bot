import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { createDatabasePool } from "../../src/core/database/database.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const expectedTables = [
  "auth_sessions",
  "business_integrations",
  "business_api_credentials",
  "business_memberships",
  "businesses",
  "categories",
  "customers",
  "fulfillments",
  "order_items",
  "orders",
  "payments",
  "product_prices",
  "product_provider_mappings",
  "products",
  "provider_services",
  "quotes",
  "users",
] as const;

const expectedConstraints = new Map([
  ["customers_business_id_id_unique", "u"],
  ["fulfillments_integration_business_fk", "f"],
  ["fulfillments_order_business_fk", "f"],
  ["fulfillments_order_item_business_fk", "f"],
  ["fulfillments_order_item_unique", "u"],
  ["fulfillments_service_integration_business_fk", "f"],
  ["order_items_business_order_id_id_unique", "u"],
  ["business_integrations_business_provider_unique", "u"],
  ["business_api_credentials_business_id_fkey", "f"],
  ["business_api_credentials_token_hash_unique", "u"],
  ["business_integrations_config_object", "c"],
  ["business_integrations_business_id_id_unique", "u"],
  ["order_items_order_business_fk", "f"],
  ["orders_quote_business_fk", "f"],
  ["orders_quote_id_unique", "u"],
  ["orders_totals_equal", "c"],
  ["payments_order_business_fk", "f"],
  ["payments_approved_at_valid", "c"],
  ["product_prices_active_range_exclusion", "x"],
  ["product_provider_mappings_product_business_fk", "f"],
  ["product_provider_mappings_service_business_fk", "f"],
  ["products_business_id_id_unique", "u"],
  ["provider_services_integration_business_fk", "f"],
  ["provider_services_integration_external_unique", "u"],
  ["provider_services_business_integration_id_unique", "u"],
  ["provider_services_rate_positive", "c"],
  ["quotes_business_id_id_unique", "u"],
]);

test(
  "all migrations create the critical PostgreSQL schema",
  { skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is not configured" },
  async (t) => {
    if (!testDatabaseUrl) return;
    await runner({
      databaseUrl: testDatabaseUrl,
      direction: "up",
      dir: "migrations",
      migrationsTable: "pgmigrations",
      count: Infinity,
      log: () => undefined,
    });
    const db = createDatabasePool(testDatabaseUrl);
    t.after(async () => db.end());

    const migrationResult = await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM pgmigrations",
    );
    assert.equal(migrationResult.rows[0]?.count, 12);

    const tableResult = await db.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [[...expectedTables]],
    );
    assert.deepEqual(tableResult.rows.map((row) => row.table_name), [...expectedTables].sort());

    const extensionResult = await db.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'btree_gist'",
    );
    assert.equal(extensionResult.rows[0]?.extname, "btree_gist");

    const constraintResult = await db.query<{ conname: string; contype: string }>(
      `SELECT conname, contype
       FROM pg_constraint
       WHERE conname = ANY($1::text[])`,
      [[...expectedConstraints.keys()]],
    );
    assert.equal(constraintResult.rows.length, expectedConstraints.size);
    for (const constraint of constraintResult.rows) {
      assert.equal(constraint.contype, expectedConstraints.get(constraint.conname));
    }

    const paymentIndexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [[
        "payments_provider_identity_unique",
        "payments_approved_order_unique",
        "payments_business_idempotency_unique",
        "payments_provider_reference_unique",
      ]],
    );
    assert.equal(paymentIndexes.rows.length, 4);

    const providerCatalogIndexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [[
        "product_provider_mappings_active_product_unique",
        "provider_services_business_filters_idx",
        "provider_services_business_integration_idx",
      ]],
    );
    assert.equal(providerCatalogIndexes.rows.length, 3);

    const fulfillmentIndexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [[
        "fulfillments_provider_order_unique",
        "fulfillments_business_order_idx",
        "fulfillments_business_status_idx",
      ]],
    );
    assert.equal(fulfillmentIndexes.rows.length, 3);

    const apiCredentialIndexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [[
        "business_api_credentials_token_hash_unique",
        "business_api_credentials_business_status_idx",
      ]],
    );
    assert.equal(apiCredentialIndexes.rows.length, 2);

    const credentialStatuses = await db.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum
       JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
       WHERE pg_type.typname = 'api_credential_status'
       ORDER BY enumsortorder`,
    );
    assert.deepEqual(credentialStatuses.rows.map((row) => row.enumlabel), ["active", "inactive"]);

    const providerReferenceColumn = await db.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'payments'
         AND column_name = 'provider_reference_id'`,
    );
    assert.equal(providerReferenceColumn.rows[0]?.column_name, "provider_reference_id");

    const moneyResult = await db.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type = 'bigint'
         AND (table_name, column_name) IN (
           ('product_prices', 'fixed_price'),
           ('product_prices', 'unit_price'),
           ('quotes', 'total_price'),
           ('orders', 'subtotal'),
           ('orders', 'total'),
           ('order_items', 'total_price'),
           ('payments', 'amount')
         )`,
    );
    assert.equal(moneyResult.rows.length, 7);

    const providerRate = await db.query<{ data_type: string; numeric_precision: number }>(
      `SELECT data_type, numeric_precision
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'provider_services'
         AND column_name = 'rate'`,
    );
    assert.deepEqual(providerRate.rows[0], { data_type: "numeric", numeric_precision: 30 });

    const providerCharge = await db.query<{
      data_type: string; numeric_precision: number; numeric_scale: number;
    }>(
      `SELECT data_type, numeric_precision, numeric_scale
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'fulfillments'
         AND column_name = 'provider_charge'`,
    );
    assert.deepEqual(providerCharge.rows[0], {
      data_type: "numeric", numeric_precision: 30, numeric_scale: 12,
    });
  },
);
