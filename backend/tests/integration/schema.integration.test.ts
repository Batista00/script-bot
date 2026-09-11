import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { createDatabasePool } from "../../src/core/database/database.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const expectedTables = [
  "auth_sessions",
  "automation_notifications",
  "business_integrations",
  "business_payment_methods",
  "business_api_credentials",
  "business_memberships",
  "businesses",
  "job_queue",
  "categories",
  "conversation_messages",
  "conversation_sessions",
  "conversation_turns",
  "conversations",
  "customers",
  "digital_order_deliveries",
  "fulfillments",
  "order_items",
  "orders",
  "payments",
  "payment_reviewers",
  "payment_reviews",
  "product_prices",
  "product_digital_assets",
  "provider_catalog_states",
  "product_provider_mappings",
  "products",
  "provider_services",
  "quotes",
  "sales_checkouts",
  "sales_inbox",
  "sales_manual_deliveries",
  "sales_messages",
  "sales_session_tokens",
  "sales_sessions",
  "sales_settings",
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
  ["orders_totals_include_delivery", "c"],
  ["quotes_items_valid", "c"],
  ["orders_delivery_valid", "c"],
  ["quotes_delivery_valid", "c"],
  ["payments_order_business_fk", "f"],
  ["payments_payment_method_business_fk", "f"],
  ["payments_approved_at_valid", "c"],
  ["product_prices_active_range_exclusion", "x"],
  ["product_provider_mappings_product_business_fk", "f"],
  ["product_provider_mappings_service_business_fk", "f"],
  ["products_business_id_id_unique", "u"],
  ["provider_services_integration_business_fk", "f"],
  ["provider_services_integration_external_unique", "u"],
  ["provider_services_business_integration_id_unique", "u"],
  ["provider_services_rate_positive", "c"],
  ["provider_catalog_states_integration_business_fk", "f"],
  ["products_required_inputs_array", "c"],
  ["quotes_business_id_id_unique", "u"],
  ["conversations_business_id_id_unique", "u"],
  ["conversations_business_channel_thread_unique", "u"],
  ["conversations_customer_business_fk", "f"],
  ["conversations_channel_valid", "c"],
  ["conversations_external_thread_id_valid", "c"],
  ["conversations_unread_count_valid", "c"],
  ["conversation_messages_conversation_business_fk", "f"],
  ["conversation_messages_direction_valid", "c"],
  ["conversation_messages_status_valid", "c"],
  ["conversation_messages_external_message_id_valid", "c"],
  ["conversation_messages_body_valid", "c"],
  ["conversation_messages_media_type_valid", "c"],
  ["conversation_messages_media_url_valid", "c"],
  ["conversation_messages_provider_error_valid", "c"],
]);

test(
  "all migrations create the critical PostgreSQL schema",
  { skip: testDatabaseUrl ? false : "TEST_DATABASE_URL is not configured" },
  async (t) => {
    if (!testDatabaseUrl) return;
    // `singleTransaction: true` mirrors the deployment runner exactly:
    // `backend` starts with `node-pg-migrate up`, which wraps the whole batch
    // in one transaction. PostgreSQL then rejects using an enum value added
    // earlier in that same batch (`55P04`), so the schema test has to fail the
    // same way the container would instead of only passing per-migration.
    await runner({
      databaseUrl: testDatabaseUrl,
      direction: "up",
      dir: "migrations",
      migrationsTable: "pgmigrations",
      count: Infinity,
      singleTransaction: true,
      log: () => undefined,
    });
    const db = createDatabasePool(testDatabaseUrl);
    t.after(async () => db.end());

    const migrationResult = await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM pgmigrations",
    );
    assert.equal(migrationResult.rows[0]?.count, 27);

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

    const membershipStatuses = await db.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum
       JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
       WHERE pg_type.typname = 'membership_status'
       ORDER BY enumsortorder`,
    );
    assert.deepEqual(membershipStatuses.rows.map((row) => row.enumlabel), ["active", "inactive"]);

    const membershipStatusColumn = await db.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'business_memberships'
         AND column_name = 'status'`,
    );
    assert.deepEqual(membershipStatusColumn.rows[0], {
      column_name: "status",
      is_nullable: "NO",
    });

    const membershipIndexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [[
        "business_memberships_business_status_idx",
        "business_memberships_business_user_unique",
      ]],
    );
    assert.equal(membershipIndexes.rows.length, 2);

    const paymentStatuses = await db.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum
       JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
       WHERE pg_type.typname = 'payment_status'
       ORDER BY enumsortorder`,
    );
    assert.deepEqual(paymentStatuses.rows.map((row) => row.enumlabel), [
      "pending", "approved", "rejected", "cancelled", "expired", "failed", "refunded", "chargeback",
    ]);

    const fulfillmentInputColumn = await db.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'order_items'
         AND column_name = 'fulfillment_input'`,
    );
    assert.deepEqual(fulfillmentInputColumn.rows[0], {
      column_name: "fulfillment_input",
      is_nullable: "NO",
    });

    const jobQueue = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [[
        "job_queue_claim_idx",
        "job_queue_running_idx",
        "job_queue_type_status_idx",
        "job_queue_identity_unique",
      ]],
    );
    assert.equal(jobQueue.rows.length, 4);

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

    const capabilityColumns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'provider_services'
         AND column_name = ANY($1::text[])
       ORDER BY column_name`,
      [["supports_cancel", "supports_refill"]],
    );
    assert.deepEqual(capabilityColumns.rows.map((row) => row.column_name), [
      "supports_cancel", "supports_refill",
    ]);

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

    const conversationStatuses = await db.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum
       JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
       WHERE pg_type.typname = 'conversation_status'
       ORDER BY enumsortorder`,
    );
    assert.deepEqual(conversationStatuses.rows.map((row) => row.enumlabel), [
      "open", "pending", "human", "closed",
    ]);

    const conversationIndexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [[
        "conversations_business_id_id_unique",
        "conversations_business_channel_thread_unique",
        "conversations_business_status_idx",
        "conversation_messages_external_message_unique",
        "conversation_messages_business_conversation_idx",
      ]],
    );
    assert.equal(conversationIndexes.rows.length, 5);

    const dedupeIndex = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = 'conversation_messages_external_message_unique'`,
    );
    assert.match(dedupeIndex.rows[0]?.indexdef ?? "", /^CREATE UNIQUE INDEX/);
    assert.match(dedupeIndex.rows[0]?.indexdef ?? "", /WHERE \(external_message_id IS NOT NULL\)/);

    const conversationShape = await db.query<{
      table_name: string; column_name: string; is_nullable: string;
    }>(
      `SELECT table_name, column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (
           (table_name = 'conversations' AND column_name IN (
             'business_id', 'customer_id', 'channel', 'status', 'unread_count'
           ))
           OR (table_name = 'conversation_messages' AND column_name IN (
             'business_id', 'conversation_id', 'direction', 'status', 'created_at'
           ))
         )
       ORDER BY table_name, column_name`,
    );
    assert.equal(conversationShape.rows.length, 10);
    assert.ok(conversationShape.rows.every((row) => row.is_nullable === "NO"));
  },
);
