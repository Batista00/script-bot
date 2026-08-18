/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE integration_status AS ENUM ('active', 'inactive');

    CREATE TABLE business_integrations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      provider_key text NOT NULL,
      status integration_status NOT NULL DEFAULT 'active',
      config jsonb NOT NULL DEFAULT '{}'::jsonb,
      credentials_encrypted text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT business_integrations_business_provider_unique
        UNIQUE (business_id, provider_key),
      CONSTRAINT business_integrations_provider_key_valid CHECK (
        provider_key ~ '^[a-z0-9][a-z0-9_]{0,63}$'
      ),
      CONSTRAINT business_integrations_config_object CHECK (
        jsonb_typeof(config) = 'object'
      ),
      CONSTRAINT business_integrations_credentials_present CHECK (
        char_length(credentials_encrypted) BETWEEN 1 AND 65535
        AND credentials_encrypted = btrim(credentials_encrypted)
      )
    );

    CREATE INDEX business_integrations_business_status_idx
      ON business_integrations (business_id, status);
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE business_integrations;
    DROP TYPE integration_status;
  `);
};
