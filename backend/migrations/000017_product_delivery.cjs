/** Null preserves fulfillment behavior of existing products. */
module.exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE products ADD COLUMN delivery_config jsonb;
    ALTER TABLE products ADD CONSTRAINT products_delivery_config_object
      CHECK (delivery_config IS NULL OR jsonb_typeof(delivery_config)='object');`);
};
module.exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE products DROP COLUMN delivery_config;`);
};
