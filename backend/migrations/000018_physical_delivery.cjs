exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE quotes ADD COLUMN delivery jsonb;
    ALTER TABLE orders ADD COLUMN delivery jsonb;
    ALTER TABLE orders DROP CONSTRAINT orders_totals_equal;
    ALTER TABLE orders ADD CONSTRAINT orders_totals_include_delivery
      CHECK (total = subtotal + COALESCE((delivery->>'fee')::bigint,0));
    ALTER TABLE quotes ADD CONSTRAINT quotes_delivery_valid CHECK (delivery IS NULL OR (
      jsonb_typeof(delivery)='object' AND delivery->>'method' IN ('shipping','pickup')
      AND (delivery->>'fee')::bigint BETWEEN 0 AND 9007199254740991
      AND total_price > (delivery->>'fee')::bigint));
    ALTER TABLE orders ADD CONSTRAINT orders_delivery_valid CHECK (delivery IS NULL OR (
      jsonb_typeof(delivery)='object' AND delivery->>'method' IN ('shipping','pickup')
      AND (delivery->>'fee')::bigint BETWEEN 0 AND 9007199254740991));
  `);
};
exports.down = pgm => {
  // Refuse to discard recorded shipping charges: roll forward once these orders exist.
  pgm.sql(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM orders WHERE delivery IS NOT NULL)
    OR EXISTS(SELECT 1 FROM quotes WHERE delivery IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove physical delivery snapshots in use'; END IF; END $$;
    ALTER TABLE orders DROP CONSTRAINT orders_totals_include_delivery;
    ALTER TABLE orders DROP COLUMN delivery;
    ALTER TABLE quotes DROP COLUMN delivery;
    ALTER TABLE orders ADD CONSTRAINT orders_totals_equal CHECK (subtotal=total);`);
};
