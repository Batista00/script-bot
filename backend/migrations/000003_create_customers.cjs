/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE customer_status AS ENUM ('active', 'inactive');

    CREATE TABLE customers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name text,
      phone text,
      email text,
      status customer_status NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT customers_name_valid CHECK (
        name IS NULL OR (char_length(name) BETWEEN 1 AND 120 AND name = btrim(name))
      ),
      CONSTRAINT customers_phone_valid CHECK (
        phone IS NULL OR phone ~ '^\\+?[0-9]{1,32}$'
      ),
      CONSTRAINT customers_email_valid CHECK (
        email IS NULL OR (
          char_length(email) BETWEEN 3 AND 254
          AND email = lower(btrim(email))
        )
      ),
      CONSTRAINT customers_contact_required CHECK (phone IS NOT NULL OR email IS NOT NULL)
    );

    CREATE INDEX customers_business_id_idx ON customers (business_id);
    CREATE UNIQUE INDEX customers_business_phone_unique
      ON customers (business_id, phone)
      WHERE phone IS NOT NULL;
    CREATE UNIQUE INDEX customers_business_email_unique_ci
      ON customers (business_id, lower(email))
      WHERE email IS NOT NULL;
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE customers;
    DROP TYPE customer_status;
  `);
};
