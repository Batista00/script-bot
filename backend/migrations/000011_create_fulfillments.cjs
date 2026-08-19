/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE fulfillment_status AS ENUM (
      'pending',
      'submitting',
      'submitted',
      'in_progress',
      'completed',
      'partial',
      'cancelled',
      'failed',
      'submission_unknown'
    );

    ALTER TABLE order_items
      ADD CONSTRAINT order_items_business_order_id_id_unique
      UNIQUE (business_id, order_id, id);

    ALTER TABLE provider_services
      ADD CONSTRAINT provider_services_business_integration_id_unique
      UNIQUE (business_id, integration_id, id);

    CREATE TABLE fulfillments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      order_id uuid NOT NULL,
      order_item_id uuid NOT NULL,
      product_id uuid NOT NULL,
      integration_id uuid NOT NULL,
      provider_service_id uuid NOT NULL,
      provider_key text NOT NULL,
      external_service_id text NOT NULL,
      provider_service_type text,
      quantity integer NOT NULL,
      status fulfillment_status NOT NULL DEFAULT 'pending',
      provider_order_id text,
      provider_status_raw text,
      input_data jsonb NOT NULL,
      provider_charge numeric(30, 12),
      provider_currency text,
      provider_remains integer,
      provider_start_count integer,
      submission_attempted_at timestamptz,
      submitted_at timestamptz,
      last_status_synced_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fulfillments_order_business_fk
        FOREIGN KEY (business_id, order_id)
        REFERENCES orders(business_id, id) ON DELETE CASCADE,
      CONSTRAINT fulfillments_order_item_business_fk
        FOREIGN KEY (business_id, order_id, order_item_id)
        REFERENCES order_items(business_id, order_id, id) ON DELETE CASCADE,
      CONSTRAINT fulfillments_product_business_fk
        FOREIGN KEY (business_id, product_id)
        REFERENCES products(business_id, id),
      CONSTRAINT fulfillments_integration_business_fk
        FOREIGN KEY (business_id, integration_id)
        REFERENCES business_integrations(business_id, id),
      CONSTRAINT fulfillments_service_integration_business_fk
        FOREIGN KEY (business_id, integration_id, provider_service_id)
        REFERENCES provider_services(business_id, integration_id, id),
      CONSTRAINT fulfillments_order_item_unique UNIQUE (business_id, order_item_id),
      CONSTRAINT fulfillments_provider_key_valid CHECK (
        provider_key ~ '^[a-z0-9][a-z0-9_]{0,63}$'
      ),
      CONSTRAINT fulfillments_external_service_id_valid CHECK (
        char_length(external_service_id) BETWEEN 1 AND 128
        AND external_service_id = btrim(external_service_id)
      ),
      CONSTRAINT fulfillments_provider_service_type_valid CHECK (
        provider_service_type IS NULL OR (
          char_length(provider_service_type) BETWEEN 1 AND 255
          AND provider_service_type = btrim(provider_service_type)
        )
      ),
      CONSTRAINT fulfillments_quantity_positive CHECK (quantity > 0),
      CONSTRAINT fulfillments_provider_order_id_valid CHECK (
        provider_order_id IS NULL OR (
          char_length(provider_order_id) BETWEEN 1 AND 128
          AND provider_order_id = btrim(provider_order_id)
        )
      ),
      CONSTRAINT fulfillments_provider_status_raw_valid CHECK (
        provider_status_raw IS NULL OR (
          char_length(provider_status_raw) BETWEEN 1 AND 255
          AND provider_status_raw = btrim(provider_status_raw)
        )
      ),
      CONSTRAINT fulfillments_input_object CHECK (
        jsonb_typeof(input_data) = 'object'
        AND octet_length(input_data::text) <= 32768
      ),
      CONSTRAINT fulfillments_provider_charge_valid CHECK (
        provider_charge IS NULL OR provider_charge >= 0
      ),
      CONSTRAINT fulfillments_provider_currency_valid CHECK (
        provider_currency IS NULL OR provider_currency ~ '^[A-Z]{3}$'
      ),
      CONSTRAINT fulfillments_provider_remains_valid CHECK (
        provider_remains IS NULL OR provider_remains >= 0
      ),
      CONSTRAINT fulfillments_provider_start_count_valid CHECK (
        provider_start_count IS NULL OR provider_start_count >= 0
      ),
      CONSTRAINT fulfillments_submitted_shape CHECK (
        status NOT IN ('submitted', 'in_progress', 'completed', 'partial', 'cancelled')
        OR (provider_order_id IS NOT NULL AND submitted_at IS NOT NULL)
      ),
      CONSTRAINT fulfillments_completed_at_valid CHECK (
        (status = 'completed' AND completed_at IS NOT NULL)
        OR (status <> 'completed' AND completed_at IS NULL)
      )
    );

    CREATE UNIQUE INDEX fulfillments_provider_order_unique
      ON fulfillments (integration_id, provider_order_id)
      WHERE provider_order_id IS NOT NULL;
    CREATE INDEX fulfillments_business_order_idx
      ON fulfillments (business_id, order_id, created_at, id);
    CREATE INDEX fulfillments_business_status_idx
      ON fulfillments (business_id, status);
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE fulfillments;
    ALTER TABLE provider_services
      DROP CONSTRAINT provider_services_business_integration_id_unique;
    ALTER TABLE order_items
      DROP CONSTRAINT order_items_business_order_id_id_unique;
    DROP TYPE fulfillment_status;
  `);
};
