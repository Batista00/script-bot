/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE job_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

    CREATE TABLE job_queue (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      job_type text NOT NULL,
      job_key text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      status job_status NOT NULL DEFAULT 'pending',
      priority integer NOT NULL DEFAULT 0,
      attempts integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 5,
      run_at timestamptz NOT NULL DEFAULT now(),
      locked_at timestamptz,
      locked_by text,
      last_error text,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT job_queue_type_valid CHECK (job_type ~ '^[a-z][a-z0-9_.]{0,63}$'),
      CONSTRAINT job_queue_key_valid CHECK (
        char_length(job_key) BETWEEN 1 AND 200 AND job_key = btrim(job_key)
      ),
      CONSTRAINT job_queue_payload_object CHECK (
        jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 32768
      ),
      CONSTRAINT job_queue_attempts_valid CHECK (
        attempts >= 0 AND max_attempts >= 0 AND attempts <= max_attempts
      ),
      CONSTRAINT job_queue_priority_valid CHECK (priority BETWEEN -100 AND 100),
      CONSTRAINT job_queue_locked_shape CHECK (
        (status = 'running' AND locked_at IS NOT NULL AND locked_by IS NOT NULL)
        OR (status <> 'running' AND locked_at IS NULL AND locked_by IS NULL)
      ),
      CONSTRAINT job_queue_completed_shape CHECK (
        (status = 'completed' AND completed_at IS NOT NULL)
        OR (status <> 'completed' AND completed_at IS NULL)
      ),
      CONSTRAINT job_queue_last_error_valid CHECK (
        last_error IS NULL OR char_length(last_error) BETWEEN 1 AND 2000
      ),
      CONSTRAINT job_queue_identity_unique UNIQUE (job_type, job_key)
    );

    CREATE INDEX job_queue_claim_idx
      ON job_queue (priority DESC, run_at ASC, created_at ASC)
      WHERE status = 'pending';

    CREATE INDEX job_queue_running_idx
      ON job_queue (locked_at ASC)
      WHERE status = 'running';

    CREATE INDEX job_queue_type_status_idx
      ON job_queue (job_type, status, created_at DESC, id DESC);
  `);
};

/** @type {(pgm: import("node-pg-migrate").MigrationBuilder) => void} */
module.exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE job_queue;
    DROP TYPE job_status;
  `);
};
