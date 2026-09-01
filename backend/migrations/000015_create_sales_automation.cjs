/** Durable sales state, private payment evidence and notification delivery. */
module.exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE payments ADD CONSTRAINT payments_business_id_id_unique UNIQUE (business_id,id);
    CREATE TABLE sales_settings (
      business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      config jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object'),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE sales_inbox (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      message_id text NOT NULL,contact text NOT NULL CHECK(contact ~ '^[0-9]{8,15}$'),
      payload jsonb NOT NULL,request_hash text NOT NULL,
      attempts integer NOT NULL DEFAULT 0,lease uuid,lease_until timestamptz,
      available_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(business_id,contact,message_id)
    );
    CREATE TABLE sales_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      customer_id uuid NOT NULL,
      contact text NOT NULL CHECK (contact ~ '^[0-9]{8,15}$'),
      state jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(state) = 'object'),
      paused boolean NOT NULL DEFAULT false,
      typebot_session_id text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, id), UNIQUE (business_id, contact),
      FOREIGN KEY (business_id, customer_id) REFERENCES customers(business_id, id)
    );
    CREATE TABLE sales_session_tokens (
      token_hash text PRIMARY KEY,
      business_id uuid NOT NULL,
      session_id uuid NOT NULL,
      expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
      FOREIGN KEY (business_id, session_id) REFERENCES sales_sessions(business_id, id) ON DELETE CASCADE
    );
    CREATE TABLE sales_messages (
      business_id uuid NOT NULL,
      session_id uuid NOT NULL,
      message_id text NOT NULL CHECK (char_length(message_id) BETWEEN 1 AND 128),
      request_hash text NOT NULL,
      response jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (session_id, message_id),
      FOREIGN KEY (business_id, session_id) REFERENCES sales_sessions(business_id, id) ON DELETE CASCADE
    );
    CREATE TABLE sales_checkouts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      session_id uuid NOT NULL,
      quote_id uuid NOT NULL,
      order_id uuid,
      payment_id uuid,
      delivery jsonb NOT NULL CHECK (jsonb_typeof(delivery) = 'object'),
      last_order_status text,
      attention_code text,
      next_check_at timestamptz NOT NULL DEFAULT now(),
      closed boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, id), UNIQUE (business_id, quote_id), UNIQUE (business_id, order_id),
      FOREIGN KEY (business_id, session_id) REFERENCES sales_sessions(business_id, id),
      FOREIGN KEY (business_id, quote_id) REFERENCES quotes(business_id, id),
      FOREIGN KEY (business_id, order_id) REFERENCES orders(business_id, id),
      FOREIGN KEY (business_id, payment_id) REFERENCES payments(business_id, id)
    );
    CREATE INDEX sales_checkouts_due_idx ON sales_checkouts(business_id, next_check_at) WHERE NOT closed;
    CREATE TABLE sales_manual_deliveries (
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, checkout_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
      note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 1000), created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (business_id,checkout_id),
      FOREIGN KEY (business_id,checkout_id) REFERENCES sales_checkouts(business_id,id)
    );
    CREATE TABLE payment_reviewers (
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      telegram_user_id text NOT NULL CHECK (telegram_user_id ~ '^[0-9]{1,20}$'),
      user_id uuid NOT NULL REFERENCES users(id),
      PRIMARY KEY (business_id, telegram_user_id)
    );
    CREATE TABLE payment_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      payment_id uuid NOT NULL,
      session_id uuid NOT NULL,
      evidence_hash text NOT NULL,
      evidence_encrypted text,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approving','approved','rejected','more_info')),
      reviewer_id uuid REFERENCES users(id),
      reference text,
      callback_hash text NOT NULL UNIQUE,
      callback_encrypted text NOT NULL,
      expires_at timestamptz NOT NULL DEFAULT now() + interval '48 hours',
      created_at timestamptz NOT NULL DEFAULT now(),
      decided_at timestamptz,
      UNIQUE (business_id, id), UNIQUE (business_id, payment_id, evidence_hash),
      FOREIGN KEY (business_id, payment_id) REFERENCES payments(business_id, id),
      FOREIGN KEY (business_id, session_id) REFERENCES sales_sessions(business_id, id)
    );
    CREATE TABLE automation_notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      event_key text NOT NULL,
      channel text NOT NULL CHECK (channel IN ('whatsapp','telegram')),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      attempts integer NOT NULL DEFAULT 0,
      lease uuid,
      lease_until timestamptz,
      available_at timestamptz NOT NULL DEFAULT now(),
      delivered_at timestamptz,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (business_id, event_key)
    );
    CREATE INDEX automation_notifications_pending_idx ON automation_notifications(business_id, available_at)
      WHERE delivered_at IS NULL;
  `);
};
module.exports.down = (pgm) => {
  pgm.sql(`DROP TABLE automation_notifications, payment_reviews, payment_reviewers,
    sales_manual_deliveries, sales_checkouts, sales_messages, sales_session_tokens, sales_sessions, sales_settings, sales_inbox;
    ALTER TABLE payments DROP CONSTRAINT payments_business_id_id_unique;`);
};
