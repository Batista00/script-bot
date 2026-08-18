/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE order_status AS ENUM (
      'pending_payment',
      'paid',
      'processing',
      'completed',
      'cancelled',
      'failed'
    );

    ALTER TABLE quotes
      ADD CONSTRAINT quotes_business_id_id_unique UNIQUE (business_id, id);

    CREATE TABLE orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      customer_id uuid NOT NULL,
      quote_id uuid NOT NULL,
      status order_status NOT NULL DEFAULT 'pending_payment',
      currency text NOT NULL,
      subtotal bigint NOT NULL,
      total bigint NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT orders_customer_business_fk
        FOREIGN KEY (business_id, customer_id)
        REFERENCES customers(business_id, id),
      CONSTRAINT orders_quote_business_fk
        FOREIGN KEY (business_id, quote_id)
        REFERENCES quotes(business_id, id),
      CONSTRAINT orders_quote_id_unique UNIQUE (quote_id),
      CONSTRAINT orders_business_id_id_unique UNIQUE (business_id, id),
      CONSTRAINT orders_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
      CONSTRAINT orders_subtotal_valid CHECK (
        subtotal BETWEEN 1 AND 9007199254740991
      ),
      CONSTRAINT orders_total_valid CHECK (
        total BETWEEN 1 AND 9007199254740991
      ),
      CONSTRAINT orders_totals_equal CHECK (subtotal = total)
    );

    CREATE INDEX orders_business_created_idx ON orders (business_id, created_at DESC);
    CREATE INDEX orders_business_customer_idx ON orders (business_id, customer_id);
    CREATE INDEX orders_business_status_idx ON orders (business_id, status);

    CREATE TABLE order_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      order_id uuid NOT NULL,
      product_id uuid NOT NULL,
      product_name text NOT NULL,
      quantity integer NOT NULL,
      pricing_type pricing_type NOT NULL,
      unit_price bigint,
      total_price bigint NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT order_items_order_business_fk
        FOREIGN KEY (business_id, order_id)
        REFERENCES orders(business_id, id) ON DELETE CASCADE,
      CONSTRAINT order_items_product_business_fk
        FOREIGN KEY (business_id, product_id)
        REFERENCES products(business_id, id),
      CONSTRAINT order_items_product_name_valid CHECK (
        char_length(product_name) BETWEEN 1 AND 160 AND product_name = btrim(product_name)
      ),
      CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
      CONSTRAINT order_items_price_shape_valid CHECK (
        (pricing_type = 'fixed' AND unit_price IS NULL)
        OR
        (pricing_type = 'unit' AND unit_price BETWEEN 1 AND 9007199254740991)
      ),
      CONSTRAINT order_items_total_price_valid CHECK (
        total_price BETWEEN 1 AND 9007199254740991
      )
    );

    CREATE INDEX order_items_business_order_idx
      ON order_items (business_id, order_id);
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE order_items;
    DROP TABLE orders;
    ALTER TABLE quotes DROP CONSTRAINT quotes_business_id_id_unique;
    DROP TYPE order_status;
  `);
};
