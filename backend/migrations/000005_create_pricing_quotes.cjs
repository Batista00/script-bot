/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS btree_gist;

    CREATE TYPE pricing_type AS ENUM ('fixed', 'unit');
    CREATE TYPE pricing_status AS ENUM ('active', 'inactive');
    CREATE TYPE quote_status AS ENUM ('active', 'expired', 'converted', 'cancelled');

    ALTER TABLE products
      ADD CONSTRAINT products_business_id_id_unique UNIQUE (business_id, id);
    ALTER TABLE customers
      ADD CONSTRAINT customers_business_id_id_unique UNIQUE (business_id, id);

    CREATE TABLE product_prices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      product_id uuid NOT NULL,
      pricing_type pricing_type NOT NULL,
      currency text NOT NULL,
      fixed_price bigint,
      unit_price bigint,
      min_quantity integer,
      max_quantity integer,
      status pricing_status NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT product_prices_product_business_fk
        FOREIGN KEY (business_id, product_id)
        REFERENCES products(business_id, id) ON DELETE CASCADE,
      CONSTRAINT product_prices_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
      CONSTRAINT product_prices_shape_valid CHECK (
        (pricing_type = 'fixed' AND fixed_price IS NOT NULL AND unit_price IS NULL)
        OR
        (pricing_type = 'unit' AND unit_price IS NOT NULL AND fixed_price IS NULL)
      ),
      CONSTRAINT product_prices_fixed_price_valid CHECK (
        fixed_price IS NULL OR fixed_price BETWEEN 1 AND 9007199254740991
      ),
      CONSTRAINT product_prices_unit_price_valid CHECK (
        unit_price IS NULL OR unit_price BETWEEN 1 AND 9007199254740991
      ),
      CONSTRAINT product_prices_min_quantity_positive CHECK (
        min_quantity IS NULL OR min_quantity > 0
      ),
      CONSTRAINT product_prices_max_quantity_positive CHECK (
        max_quantity IS NULL OR max_quantity > 0
      ),
      CONSTRAINT product_prices_quantity_range_valid CHECK (
        min_quantity IS NULL OR max_quantity IS NULL OR max_quantity >= min_quantity
      ),
      CONSTRAINT product_prices_active_range_exclusion EXCLUDE USING gist (
        business_id WITH =,
        product_id WITH =,
        currency WITH =,
        int4range(min_quantity, max_quantity, '[]') WITH &&
      ) WHERE (status = 'active')
    );

    CREATE INDEX product_prices_business_product_idx
      ON product_prices (business_id, product_id);

    CREATE TABLE quotes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      customer_id uuid,
      product_id uuid NOT NULL,
      quantity integer NOT NULL,
      product_name text NOT NULL,
      currency text NOT NULL,
      pricing_type pricing_type NOT NULL,
      unit_price bigint,
      total_price bigint NOT NULL,
      status quote_status NOT NULL DEFAULT 'active',
      expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT quotes_product_business_fk
        FOREIGN KEY (business_id, product_id)
        REFERENCES products(business_id, id),
      CONSTRAINT quotes_customer_business_fk
        FOREIGN KEY (business_id, customer_id)
        REFERENCES customers(business_id, id),
      CONSTRAINT quotes_quantity_positive CHECK (quantity > 0),
      CONSTRAINT quotes_product_name_valid CHECK (
        char_length(product_name) BETWEEN 1 AND 160 AND product_name = btrim(product_name)
      ),
      CONSTRAINT quotes_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
      CONSTRAINT quotes_price_shape_valid CHECK (
        (pricing_type = 'fixed' AND unit_price IS NULL)
        OR
        (pricing_type = 'unit' AND unit_price BETWEEN 1 AND 9007199254740991)
      ),
      CONSTRAINT quotes_total_price_valid CHECK (
        total_price BETWEEN 1 AND 9007199254740991
      )
    );

    CREATE INDEX quotes_business_created_idx ON quotes (business_id, created_at DESC);
    CREATE INDEX quotes_business_customer_idx ON quotes (business_id, customer_id);
    CREATE INDEX quotes_business_product_idx ON quotes (business_id, product_id);
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE quotes;
    DROP TABLE product_prices;
    ALTER TABLE customers DROP CONSTRAINT customers_business_id_id_unique;
    ALTER TABLE products DROP CONSTRAINT products_business_id_id_unique;
    DROP TYPE quote_status;
    DROP TYPE pricing_status;
    DROP TYPE pricing_type;
  `);
};
