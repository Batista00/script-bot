/**
 * Estado conversacional durable del orquestador comercial.
 *
 * La conversación de WhatsApp (Evolution) y la presentación (Typebot) son
 * stateless respecto al negocio: la fuente de verdad vive aquí. `payload`
 * guarda el avance de la venta (categoría, producto, cantidad, campos
 * recogidos, quote/order/payment) para que un mensaje posterior continúe
 * exactamente donde quedó.
 *
 * `conversation_turns` implementa la deduplicación: un mismo turno (messageId
 * real de Evolution o huella normalizada del payload) se resuelve una sola vez
 * y su respuesta se reproduce tal cual.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE conversation_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      remote_jid text NOT NULL,
      customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
      state text NOT NULL DEFAULT 'WELCOME',
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      page integer NOT NULL DEFAULT 0,
      typebot_session_id text,
      handoff boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT conversation_sessions_remote_jid_valid CHECK (
        char_length(remote_jid) BETWEEN 3 AND 200
      ),
      CONSTRAINT conversation_sessions_state_valid CHECK (
        char_length(state) BETWEEN 1 AND 64
      ),
      CONSTRAINT conversation_sessions_payload_object CHECK (jsonb_typeof(payload) = 'object'),
      CONSTRAINT conversation_sessions_page_valid CHECK (page >= 0),
      CONSTRAINT conversation_sessions_business_remote_unique UNIQUE (business_id, remote_jid)
    );

    CREATE INDEX conversation_sessions_customer_idx
      ON conversation_sessions (business_id, customer_id);

    CREATE TABLE conversation_turns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      remote_jid text NOT NULL,
      dedupe_key text NOT NULL,
      response jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT conversation_turns_key_valid CHECK (
        char_length(dedupe_key) BETWEEN 8 AND 200
      ),
      CONSTRAINT conversation_turns_business_key_unique UNIQUE (business_id, dedupe_key)
    );

    CREATE INDEX conversation_turns_created_idx ON conversation_turns (created_at);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS conversation_turns;
    DROP TABLE IF EXISTS conversation_sessions;
  `);
};
