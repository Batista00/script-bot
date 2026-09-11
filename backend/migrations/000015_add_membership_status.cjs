/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE membership_status AS ENUM ('active', 'inactive');

    ALTER TABLE business_memberships
      ADD COLUMN status membership_status NOT NULL DEFAULT 'active';

    CREATE INDEX business_memberships_business_status_idx
      ON business_memberships (business_id, status);
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX business_memberships_business_status_idx;
    ALTER TABLE business_memberships DROP COLUMN status;
    DROP TYPE membership_status;
  `);
};
