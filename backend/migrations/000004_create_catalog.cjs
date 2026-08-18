/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE catalog_status AS ENUM ('active', 'inactive');
    CREATE TYPE product_type AS ENUM ('service', 'product');

    CREATE TABLE categories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name text NOT NULL,
      status catalog_status NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT categories_name_valid CHECK (
        char_length(name) BETWEEN 1 AND 120 AND name = btrim(name)
      )
    );

    CREATE INDEX categories_business_id_idx ON categories (business_id);
    CREATE UNIQUE INDEX categories_business_name_unique_ci
      ON categories (business_id, lower(name));

    CREATE TABLE products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
      name text NOT NULL,
      description text,
      type product_type NOT NULL,
      sku text,
      min_quantity integer,
      max_quantity integer,
      status catalog_status NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT products_name_valid CHECK (
        char_length(name) BETWEEN 1 AND 160 AND name = btrim(name)
      ),
      CONSTRAINT products_description_valid CHECK (
        description IS NULL OR (
          char_length(description) BETWEEN 1 AND 5000
          AND description = btrim(description)
        )
      ),
      CONSTRAINT products_sku_valid CHECK (
        sku IS NULL OR (
          char_length(sku) BETWEEN 1 AND 64
          AND sku = upper(btrim(sku))
        )
      ),
      CONSTRAINT products_min_quantity_positive CHECK (
        min_quantity IS NULL OR min_quantity > 0
      ),
      CONSTRAINT products_max_quantity_positive CHECK (
        max_quantity IS NULL OR max_quantity > 0
      ),
      CONSTRAINT products_quantity_range_valid CHECK (
        min_quantity IS NULL OR max_quantity IS NULL OR max_quantity >= min_quantity
      )
    );

    CREATE INDEX products_business_id_idx ON products (business_id);
    CREATE INDEX products_business_category_idx ON products (business_id, category_id);
    CREATE UNIQUE INDEX products_business_sku_unique
      ON products (business_id, sku)
      WHERE sku IS NOT NULL;
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE products;
    DROP TABLE categories;
    DROP TYPE product_type;
    DROP TYPE catalog_status;
  `);
};
