/** Two levels: a business-owned main category and its subcategories. */
module.exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE categories ADD COLUMN parent_id uuid;
    ALTER TABLE categories ADD CONSTRAINT categories_business_id_id_unique UNIQUE(business_id,id);
    ALTER TABLE categories ADD CONSTRAINT categories_parent_same_business
      FOREIGN KEY(business_id,parent_id) REFERENCES categories(business_id,id);
    ALTER TABLE categories ADD CONSTRAINT categories_parent_not_self CHECK(parent_id IS NULL OR parent_id<>id);
    CREATE INDEX categories_parent_idx ON categories(business_id,parent_id);
    CREATE FUNCTION validate_category_parent() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM 1 FROM businesses WHERE id=NEW.business_id FOR UPDATE;
      IF NEW.parent_id IS NOT NULL AND (
        EXISTS(SELECT 1 FROM categories WHERE business_id=NEW.business_id AND id=NEW.parent_id AND parent_id IS NOT NULL)
        OR EXISTS(SELECT 1 FROM categories WHERE business_id=NEW.business_id AND parent_id=NEW.id)
      ) THEN
        RAISE EXCEPTION 'Categories support main category and subcategory only' USING ERRCODE='23514',CONSTRAINT='categories_two_levels';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER categories_validate_parent BEFORE INSERT OR UPDATE OF parent_id ON categories
      FOR EACH ROW EXECUTE FUNCTION validate_category_parent();
  `);
};
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER categories_validate_parent ON categories;
    DROP FUNCTION validate_category_parent();
    ALTER TABLE categories DROP COLUMN parent_id;
    ALTER TABLE categories DROP CONSTRAINT categories_business_id_id_unique;
  `);
};
