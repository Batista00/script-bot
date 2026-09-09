exports.up=pgm=>pgm.sql(`
  CREATE TABLE product_digital_assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    product_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('download','license')),label text NOT NULL,
    value_encrypted text NOT NULL,fingerprint text NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
    reserved_order_id uuid,created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(business_id,product_id,kind,fingerprint),
    FOREIGN KEY(business_id,product_id) REFERENCES products(business_id,id),
    FOREIGN KEY(business_id,reserved_order_id) REFERENCES orders(business_id,id),
    CHECK(kind='license' OR reserved_order_id IS NULL)
  );
  CREATE UNIQUE INDEX digital_license_unique ON product_digital_assets(business_id,fingerprint) WHERE kind='license';
  CREATE INDEX digital_available_idx ON product_digital_assets(business_id,product_id,status,reserved_order_id);
  CREATE TABLE digital_order_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    order_id uuid NOT NULL,assets jsonb NOT NULL CHECK(jsonb_typeof(assets)='array'),created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(business_id,order_id),FOREIGN KEY(business_id,order_id) REFERENCES orders(business_id,id)
  );
`);
exports.down=pgm=>pgm.sql(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM product_digital_assets) OR EXISTS(SELECT 1 FROM digital_order_deliveries) THEN
  RAISE EXCEPTION 'Cannot discard digital assets or allocations'; END IF; END $$;
  DROP TABLE digital_order_deliveries; DROP TABLE product_digital_assets;`);
