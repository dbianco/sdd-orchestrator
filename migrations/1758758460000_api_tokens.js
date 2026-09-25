export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`CREATE TABLE api_tokens (
    id text PRIMARY KEY,
    actor text NOT NULL,
    name text NOT NULL,
    scopes text[] NOT NULL CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['host', 'ci', 'approver', 'admin']::text[]),
    app_ids text[],
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz,
    revoked_at timestamptz,
    revoked_reason text,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by text NOT NULL
  )`);
  pgm.sql(`ALTER TABLE phase_transitions ADD COLUMN token_id text REFERENCES api_tokens(id)`);
};

export const down = (pgm) => {
  pgm.sql(`ALTER TABLE phase_transitions DROP COLUMN IF EXISTS token_id`);
  pgm.sql(`DROP TABLE IF EXISTS api_tokens`);
};
