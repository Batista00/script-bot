/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE order_items
      ADD COLUMN fulfillment_input jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD CONSTRAINT order_items_fulfillment_input_object CHECK (
        jsonb_typeof(fulfillment_input) = 'object'
        AND octet_length(fulfillment_input::text) <= 32768
      );

    ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'refunded';
    ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'chargeback';
  `);
};

/**
 * Enum values cannot be removed in PostgreSQL, so the down migration only
 * reverts the column. The extra payment statuses stay available.
 *
 * @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void}
 */
module.exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE order_items
      DROP CONSTRAINT order_items_fulfillment_input_object,
      DROP COLUMN fulfillment_input;
  `);
};
