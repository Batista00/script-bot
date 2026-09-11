/**
 * Refunds and chargebacks happen after an approved payment, so `approved_at`
 * must survive the transition. Enum values were added in 000023; PostgreSQL
 * cannot remove them, so the down migration only restores the stricter check.
 *
 * The comparison is written over `status::text` on purpose. node-pg-migrate
 * runs the whole `up` batch inside one transaction, and PostgreSQL forbids
 * using an enum value added earlier in that same transaction (`55P04`,
 * "unsafe use of new value"). Comparing the textual representation keeps the
 * constraint identical while remaining valid whether the new labels were
 * committed by a previous run or added moments ago in this batch.
 *
 * @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void}
 */
module.exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE payments DROP CONSTRAINT payments_approved_at_valid;

    ALTER TABLE payments ADD CONSTRAINT payments_approved_at_valid CHECK (
      (status::text = 'approved' AND approved_at IS NOT NULL)
      OR (status::text IN ('refunded', 'chargeback') AND approved_at IS NOT NULL)
      OR (status::text NOT IN ('approved', 'refunded', 'chargeback') AND approved_at IS NULL)
    );
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE payments DROP CONSTRAINT payments_approved_at_valid;

    ALTER TABLE payments ADD CONSTRAINT payments_approved_at_valid CHECK (
      (status::text = 'approved' AND approved_at IS NOT NULL)
      OR (status::text <> 'approved' AND approved_at IS NULL)
    );
  `);
};
