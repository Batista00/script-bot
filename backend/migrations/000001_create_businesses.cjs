/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE business_status AS ENUM ('active', 'inactive');

    CREATE TABLE businesses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      status business_status NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT businesses_name_not_blank CHECK (char_length(btrim(name)) > 0),
      CONSTRAINT businesses_name_max_length CHECK (char_length(name) <= 120)
    );
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE businesses;
    DROP TYPE business_status;
  `);
};

