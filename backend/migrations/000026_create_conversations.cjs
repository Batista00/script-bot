/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE conversation_status AS ENUM ('open', 'pending', 'human', 'closed');

    -- customers_business_id_id_unique already exists since 000005 and backs
    -- the composite customer FK below.
    CREATE TABLE conversations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      customer_id uuid NOT NULL,
      channel text NOT NULL DEFAULT 'whatsapp',
      external_thread_id text,
      status conversation_status NOT NULL DEFAULT 'open',
      last_message_at timestamptz,
      unread_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT conversations_business_id_id_unique UNIQUE (business_id, id),
      CONSTRAINT conversations_business_channel_thread_unique
        UNIQUE (business_id, channel, external_thread_id),
      CONSTRAINT conversations_customer_business_fk
        FOREIGN KEY (business_id, customer_id)
        REFERENCES customers(business_id, id) ON DELETE CASCADE,
      CONSTRAINT conversations_channel_valid CHECK (
        channel ~ '^[a-z][a-z0-9_]{0,31}$'
      ),
      CONSTRAINT conversations_external_thread_id_valid CHECK (
        external_thread_id IS NULL OR (
          char_length(external_thread_id) BETWEEN 1 AND 200
          AND external_thread_id = btrim(external_thread_id)
        )
      ),
      CONSTRAINT conversations_unread_count_valid CHECK (unread_count >= 0)
    );

    CREATE INDEX conversations_business_status_idx
      ON conversations (business_id, status, last_message_at DESC);

    CREATE TABLE conversation_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      conversation_id uuid NOT NULL,
      direction text NOT NULL,
      external_message_id text,
      body text,
      media_type text,
      media_url text,
      status text NOT NULL DEFAULT 'received',
      provider_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT conversation_messages_conversation_business_fk
        FOREIGN KEY (business_id, conversation_id)
        REFERENCES conversations(business_id, id) ON DELETE CASCADE,
      CONSTRAINT conversation_messages_direction_valid CHECK (
        direction IN ('inbound', 'outbound')
      ),
      CONSTRAINT conversation_messages_status_valid CHECK (
        status IN ('received', 'sent', 'failed')
      ),
      CONSTRAINT conversation_messages_external_message_id_valid CHECK (
        external_message_id IS NULL OR (
          char_length(external_message_id) BETWEEN 1 AND 200
          AND external_message_id = btrim(external_message_id)
        )
      ),
      CONSTRAINT conversation_messages_body_valid CHECK (
        body IS NULL OR char_length(body) <= 8192
      ),
      CONSTRAINT conversation_messages_media_type_valid CHECK (
        media_type IS NULL OR char_length(media_type) <= 64
      ),
      CONSTRAINT conversation_messages_media_url_valid CHECK (
        media_url IS NULL OR char_length(media_url) <= 2048
      ),
      CONSTRAINT conversation_messages_provider_error_valid CHECK (
        provider_error IS NULL OR char_length(provider_error) <= 1000
      )
    );

    CREATE UNIQUE INDEX conversation_messages_external_message_unique
      ON conversation_messages (business_id, external_message_id)
      WHERE external_message_id IS NOT NULL;

    CREATE INDEX conversation_messages_business_conversation_idx
      ON conversation_messages (business_id, conversation_id, created_at DESC, id DESC);
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE conversation_messages;
    DROP TABLE conversations;
    DROP TYPE conversation_status;
  `);
};
