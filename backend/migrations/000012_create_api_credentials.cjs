/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE api_credential_status AS ENUM ('active', 'inactive');

    CREATE TABLE business_api_credentials (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name text NOT NULL,
      token_hash text NOT NULL,
      token_prefix text NOT NULL,
      status api_credential_status NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT business_api_credentials_token_hash_unique UNIQUE (token_hash),
      CONSTRAINT business_api_credentials_name_valid CHECK (
        char_length(name) BETWEEN 1 AND 120 AND name = btrim(name)
      ),
      CONSTRAINT business_api_credentials_token_hash_valid CHECK (
        token_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT business_api_credentials_token_prefix_valid CHECK (
        token_prefix ~ '^bw_[A-Za-z0-9_-]{8}$'
      )
    );

    CREATE INDEX business_api_credentials_business_status_idx
      ON business_api_credentials (business_id, status, created_at DESC, id DESC);
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE business_api_credentials;
    DROP TYPE api_credential_status;
  `);
};
