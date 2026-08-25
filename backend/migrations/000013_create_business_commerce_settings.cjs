/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE businesses
      ADD COLUMN currency text NOT NULL DEFAULT 'CLP',
      ADD CONSTRAINT businesses_currency_valid CHECK (currency ~ '^[A-Z]{3}$');

    CREATE TABLE business_payment_methods (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      type text NOT NULL,
      name text NOT NULL,
      status catalog_status NOT NULL DEFAULT 'active',
      config jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT business_payment_methods_business_id_id_unique
        UNIQUE (business_id, id),
      CONSTRAINT business_payment_methods_type_valid CHECK (
        type IN ('mercado_pago', 'bank_transfer')
      ),
      CONSTRAINT business_payment_methods_name_valid CHECK (
        char_length(name) BETWEEN 1 AND 120 AND name = btrim(name)
      ),
      CONSTRAINT business_payment_methods_config_object CHECK (
        jsonb_typeof(config) = 'object' AND octet_length(config::text) <= 16384
      )
    );

    CREATE UNIQUE INDEX business_payment_methods_business_name_unique
      ON business_payment_methods (business_id, lower(name));
    CREATE UNIQUE INDEX business_payment_methods_active_mp_unique
      ON business_payment_methods (business_id, type)
      WHERE type = 'mercado_pago' AND status = 'active';
    CREATE INDEX business_payment_methods_business_status_idx
      ON business_payment_methods (business_id, status, created_at DESC);

    ALTER TABLE payments
      ADD COLUMN payment_method_id uuid,
      ADD CONSTRAINT payments_payment_method_business_fk
        FOREIGN KEY (business_id, payment_method_id)
        REFERENCES business_payment_methods(business_id, id);

    CREATE INDEX payments_business_payment_method_idx
      ON payments (business_id, payment_method_id, created_at DESC);
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX payments_business_payment_method_idx;
    ALTER TABLE payments
      DROP CONSTRAINT payments_payment_method_business_fk,
      DROP COLUMN payment_method_id;
    DROP TABLE business_payment_methods;
    ALTER TABLE businesses
      DROP CONSTRAINT businesses_currency_valid,
      DROP COLUMN currency;
  `);
};
