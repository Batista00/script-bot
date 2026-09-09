exports.up=pgm=>pgm.sql(`ALTER TABLE quotes ADD COLUMN items jsonb;
  ALTER TABLE quotes ADD CONSTRAINT quotes_items_valid CHECK(items IS NULL OR (jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 2 AND 10));`);
exports.down=pgm=>pgm.sql(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM quotes WHERE items IS NOT NULL) THEN
  RAISE EXCEPTION 'Cannot discard recorded cart items'; END IF; END $$; ALTER TABLE quotes DROP COLUMN items;`);
