import assert from "node:assert/strict";
import { test } from "node:test";

import { runner } from "node-pg-migrate";

import { createDatabasePool } from "../../src/core/database/database.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const expectedTables = [
  "auth_sessions",
  "business_integrations",
  "business_memberships",
  "businesses",
  "categories",
  "customers",
  "order_items",
  "orders",
  "payments",
  "product_prices",
  "products",
  "quotes",
  "users",
] as const;

const expectedConstraints = new Map([
  ["customers_business_id_id_unique", "u"],
  ["business_integrations_business_provider_unique", "u"],
  ["business_integrations_config_object", "c"],
  ["order_items_order_business_fk", "f"],
  ["orders_quote_business_fk", "f"],
  ["orders_quote_id_unique", "u"],
  ["orders_totals_equal", "c"],
  ["payments_order_business_fk", "f"],
  ["payments_approved_at_valid", "c"],
  ["product_prices_active_range_exclusion", "x"],
  ["products_business_id_id_unique", "u"],
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
    assert.equal(migrationResult.rows[0]?.count, 8);

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
      ]],
    );
    assert.equal(paymentIndexes.rows.length, 3);

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
  },
);
