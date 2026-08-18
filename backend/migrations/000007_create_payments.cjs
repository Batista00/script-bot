/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE payment_status AS ENUM (
      'pending',
      'approved',
      'rejected',
      'cancelled',
      'expired',
      'failed'
    );

    CREATE TABLE payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      order_id uuid NOT NULL,
      provider_key text NOT NULL,
      provider_payment_id text,
      status payment_status NOT NULL DEFAULT 'pending',
      amount bigint NOT NULL,
      currency text NOT NULL,
      checkout_url text,
      idempotency_key text,
      expires_at timestamptz,
      approved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT payments_order_business_fk
        FOREIGN KEY (business_id, order_id)
        REFERENCES orders(business_id, id) ON DELETE CASCADE,
      CONSTRAINT payments_provider_key_valid CHECK (
        provider_key ~ '^[a-z][a-z0-9_]{0,63}$'
      ),
      CONSTRAINT payments_provider_payment_id_valid CHECK (
        provider_payment_id IS NULL OR (
          char_length(provider_payment_id) BETWEEN 1 AND 255
          AND provider_payment_id = btrim(provider_payment_id)
        )
      ),
      CONSTRAINT payments_amount_valid CHECK (
        amount BETWEEN 1 AND 9007199254740991
      ),
      CONSTRAINT payments_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
      CONSTRAINT payments_checkout_url_valid CHECK (
        checkout_url IS NULL OR (
          char_length(checkout_url) BETWEEN 1 AND 2048
          AND checkout_url = btrim(checkout_url)
        )
      ),
      CONSTRAINT payments_idempotency_key_valid CHECK (
        idempotency_key IS NULL OR (
          char_length(idempotency_key) BETWEEN 1 AND 128
          AND idempotency_key = btrim(idempotency_key)
        )
      ),
      CONSTRAINT payments_approved_at_valid CHECK (
        (status = 'approved' AND approved_at IS NOT NULL)
        OR (status <> 'approved' AND approved_at IS NULL)
      )
    );

    CREATE UNIQUE INDEX payments_provider_identity_unique
      ON payments (business_id, provider_key, provider_payment_id)
      WHERE provider_payment_id IS NOT NULL;

    CREATE UNIQUE INDEX payments_approved_order_unique
      ON payments (business_id, order_id)
      WHERE status = 'approved';

    CREATE UNIQUE INDEX payments_business_idempotency_unique
      ON payments (business_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    CREATE INDEX payments_business_created_idx
      ON payments (business_id, created_at DESC, id DESC);
    CREATE INDEX payments_business_order_idx
      ON payments (business_id, order_id, created_at DESC, id DESC);
    CREATE INDEX payments_business_status_idx
      ON payments (business_id, status);
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE payments;
    DROP TYPE payment_status;
  `);
};
