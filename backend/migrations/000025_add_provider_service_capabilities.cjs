/**
 * Provider capabilities that operators use to decide whether a service can be
 * sold: SMM Raja advertises them as booleans in the catalog payload.
 *
 * @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void}
 */
module.exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE provider_services
      ADD COLUMN supports_refill boolean,
      ADD COLUMN supports_cancel boolean;
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE provider_services
      DROP COLUMN supports_cancel,
      DROP COLUMN supports_refill;
  `);
};
