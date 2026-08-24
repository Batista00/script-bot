/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE provider_connection_status AS ENUM ('unknown', 'ok', 'error');

    ALTER TABLE provider_services
      ADD COLUMN provider_description text,
      ADD COLUMN order_capabilities jsonb NOT NULL DEFAULT '{"supported":false,"required":[],"optional":[]}'::jsonb,
      ADD CONSTRAINT provider_services_description_valid CHECK (
        provider_description IS NULL OR (
          char_length(provider_description) BETWEEN 1 AND 5000
          AND provider_description = btrim(provider_description)
        )
      ),
      ADD CONSTRAINT provider_services_capabilities_object CHECK (
        jsonb_typeof(order_capabilities) = 'object'
        AND octet_length(order_capabilities::text) <= 32768
      );

    ALTER TABLE products
      ADD COLUMN required_inputs jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD CONSTRAINT products_required_inputs_array CHECK (
        jsonb_typeof(required_inputs) = 'array'
        AND jsonb_array_length(required_inputs) <= 20
        AND octet_length(required_inputs::text) <= 32768
      );

    CREATE TABLE provider_catalog_states (
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      integration_id uuid PRIMARY KEY,
      connection_status provider_connection_status NOT NULL DEFAULT 'unknown',
      provider_balance numeric(30, 12),
      provider_currency text,
      services_received integer NOT NULL DEFAULT 0,
      services_normalized integer NOT NULL DEFAULT 0,
      services_rejected integer NOT NULL DEFAULT 0,
      rejection_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
      last_sync_at timestamptz,
      last_balance_at timestamptz,
      last_error_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT provider_catalog_states_integration_business_fk
        FOREIGN KEY (business_id, integration_id)
        REFERENCES business_integrations(business_id, id) ON DELETE CASCADE,
      CONSTRAINT provider_catalog_states_balance_nonnegative CHECK (
        provider_balance IS NULL OR provider_balance >= 0
      ),
      CONSTRAINT provider_catalog_states_currency_valid CHECK (
        provider_currency IS NULL OR provider_currency ~ '^[A-Z]{3}$'
      ),
      CONSTRAINT provider_catalog_states_counts_nonnegative CHECK (
        services_received >= 0 AND services_normalized >= 0 AND services_rejected >= 0
      ),
      CONSTRAINT provider_catalog_states_rejection_reasons_object CHECK (
        jsonb_typeof(rejection_reasons) = 'object'
        AND octet_length(rejection_reasons::text) <= 32768
      )
    );

    CREATE INDEX provider_services_business_type_idx
      ON provider_services (business_id, service_type);
    CREATE INDEX provider_services_business_external_search_idx
      ON provider_services (business_id, external_service_id);
    CREATE INDEX provider_catalog_states_business_idx
      ON provider_catalog_states (business_id, updated_at DESC);
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE provider_catalog_states;
    DROP INDEX provider_services_business_external_search_idx;
    DROP INDEX provider_services_business_type_idx;
    ALTER TABLE products DROP COLUMN required_inputs;
    ALTER TABLE provider_services
      DROP COLUMN order_capabilities,
      DROP COLUMN provider_description;
    DROP TYPE provider_connection_status;
  `);
};
