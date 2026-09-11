/**
 * Refunds and chargebacks happen after an approved payment, so `approved_at`
 * must survive the transition. Enum values were added in 000023; PostgreSQL
 * cannot remove them, so the down migration only restores the stricter check.
 *
 * @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void}
 */
module.exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE payments DROP CONSTRAINT payments_approved_at_valid;

    ALTER TABLE payments ADD CONSTRAINT payments_approved_at_valid CHECK (
      (status = 'approved' AND approved_at IS NOT NULL)
      OR (status IN ('refunded', 'chargeback') AND approved_at IS NOT NULL)
      OR (status NOT IN ('approved', 'refunded', 'chargeback') AND approved_at IS NULL)
    );
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE payments DROP CONSTRAINT payments_approved_at_valid;

    ALTER TABLE payments ADD CONSTRAINT payments_approved_at_valid CHECK (
      (status = 'approved' AND approved_at IS NOT NULL)
      OR (status <> 'approved' AND approved_at IS NULL)
    );
  `);
};
