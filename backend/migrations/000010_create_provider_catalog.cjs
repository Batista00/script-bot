/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE provider_service_status AS ENUM ('active', 'inactive');
    CREATE TYPE provider_mapping_status AS ENUM ('active', 'inactive');

    ALTER TABLE business_integrations
      ADD CONSTRAINT business_integrations_business_id_id_unique
      UNIQUE (business_id, id);

    CREATE TABLE provider_services (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      integration_id uuid NOT NULL,
      provider_key text NOT NULL,
      external_service_id text NOT NULL,
      name text NOT NULL,
      category text,
      service_type text,
      rate numeric(30, 12),
      rate_currency text,
      min_quantity integer,
      max_quantity integer,
      provider_status provider_service_status NOT NULL DEFAULT 'active',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      last_synced_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT provider_services_integration_business_fk
        FOREIGN KEY (business_id, integration_id)
        REFERENCES business_integrations(business_id, id) ON DELETE CASCADE,
      CONSTRAINT provider_services_integration_external_unique
        UNIQUE (integration_id, external_service_id),
      CONSTRAINT provider_services_business_id_id_unique
        UNIQUE (business_id, id),
      CONSTRAINT provider_services_provider_key_valid CHECK (
        provider_key ~ '^[a-z0-9][a-z0-9_]{0,63}$'
      ),
      CONSTRAINT provider_services_external_id_valid CHECK (
        char_length(external_service_id) BETWEEN 1 AND 128
        AND external_service_id = btrim(external_service_id)
      ),
      CONSTRAINT provider_services_name_valid CHECK (
        char_length(name) BETWEEN 1 AND 500 AND name = btrim(name)
      ),
      CONSTRAINT provider_services_category_valid CHECK (
        category IS NULL OR (
          char_length(category) BETWEEN 1 AND 255 AND category = btrim(category)
        )
      ),
      CONSTRAINT provider_services_type_valid CHECK (
        service_type IS NULL OR (
          char_length(service_type) BETWEEN 1 AND 255 AND service_type = btrim(service_type)
        )
      ),
      CONSTRAINT provider_services_rate_positive CHECK (rate IS NULL OR rate > 0),
      CONSTRAINT provider_services_rate_currency_valid CHECK (
        rate_currency IS NULL OR rate_currency ~ '^[A-Z]{3}$'
      ),
      CONSTRAINT provider_services_min_positive CHECK (
        min_quantity IS NULL OR min_quantity > 0
      ),
      CONSTRAINT provider_services_max_positive CHECK (
        max_quantity IS NULL OR max_quantity > 0
      ),
      CONSTRAINT provider_services_quantity_range_valid CHECK (
        min_quantity IS NULL OR max_quantity IS NULL OR max_quantity >= min_quantity
      ),
      CONSTRAINT provider_services_metadata_object CHECK (
        jsonb_typeof(metadata) = 'object'
        AND octet_length(metadata::text) <= 65535
      )
    );

    CREATE INDEX provider_services_business_created_idx
      ON provider_services (business_id, created_at DESC, id DESC);
    CREATE INDEX provider_services_business_filters_idx
      ON provider_services (business_id, provider_key, provider_status);
    CREATE INDEX provider_services_business_integration_idx
      ON provider_services (business_id, integration_id);
    CREATE INDEX provider_services_business_category_idx
      ON provider_services (business_id, category);

    CREATE TABLE product_provider_mappings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      product_id uuid NOT NULL,
      provider_service_id uuid NOT NULL,
      status provider_mapping_status NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT product_provider_mappings_product_business_fk
        FOREIGN KEY (business_id, product_id)
        REFERENCES products(business_id, id) ON DELETE CASCADE,
      CONSTRAINT product_provider_mappings_service_business_fk
        FOREIGN KEY (business_id, provider_service_id)
        REFERENCES provider_services(business_id, id)
    );

    CREATE UNIQUE INDEX product_provider_mappings_active_product_unique
      ON product_provider_mappings (business_id, product_id)
      WHERE status = 'active';
    CREATE INDEX product_provider_mappings_product_history_idx
      ON product_provider_mappings (business_id, product_id, created_at DESC, id DESC);
    CREATE INDEX product_provider_mappings_service_idx
      ON product_provider_mappings (business_id, provider_service_id);
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE product_provider_mappings;
    DROP TABLE provider_services;
    ALTER TABLE business_integrations
      DROP CONSTRAINT business_integrations_business_id_id_unique;
    DROP TYPE provider_mapping_status;
    DROP TYPE provider_service_status;
  `);
};
