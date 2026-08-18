/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE user_status AS ENUM ('active', 'inactive');
    CREATE TYPE business_membership_role AS ENUM ('owner', 'admin', 'operator');

    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL,
      name text NOT NULL,
      password_hash text NOT NULL,
      status user_status NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT users_email_not_blank CHECK (char_length(btrim(email)) > 0),
      CONSTRAINT users_email_max_length CHECK (char_length(email) <= 254),
      CONSTRAINT users_name_not_blank CHECK (char_length(btrim(name)) > 0),
      CONSTRAINT users_name_max_length CHECK (char_length(name) <= 120),
      CONSTRAINT users_password_hash_not_blank CHECK (char_length(password_hash) > 0)
    );

    CREATE UNIQUE INDEX users_email_unique_ci ON users (lower(email));

    CREATE TABLE business_memberships (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role business_membership_role NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT business_memberships_business_user_unique UNIQUE (business_id, user_id)
    );

    CREATE INDEX business_memberships_user_id_idx ON business_memberships (user_id);

    CREATE TABLE auth_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash text UNIQUE NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT auth_sessions_token_hash_not_blank CHECK (char_length(token_hash) > 0)
    );

    CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);
    CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions (expires_at);
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE auth_sessions;
    DROP TABLE business_memberships;
    DROP TABLE users;
    DROP TYPE business_membership_role;
    DROP TYPE user_status;
  `);
};
