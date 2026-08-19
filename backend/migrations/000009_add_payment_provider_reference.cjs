/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE payments
      ADD COLUMN provider_reference_id text,
      ADD CONSTRAINT payments_provider_reference_id_valid CHECK (
        provider_reference_id IS NULL OR (
          char_length(provider_reference_id) BETWEEN 1 AND 255
          AND provider_reference_id = btrim(provider_reference_id)
        )
      );

    CREATE UNIQUE INDEX payments_provider_reference_unique
      ON payments (business_id, provider_key, provider_reference_id)
      WHERE provider_reference_id IS NOT NULL;
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX payments_provider_reference_unique;
    ALTER TABLE payments
      DROP CONSTRAINT payments_provider_reference_id_valid,
      DROP COLUMN provider_reference_id;
  `);
};
