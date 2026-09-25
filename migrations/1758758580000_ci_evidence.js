export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`CREATE TABLE ci_evidence (
    id text PRIMARY KEY,
    app_id text NOT NULL REFERENCES apps(id),
    feature_id text NOT NULL REFERENCES features(id),
    commit_sha text NOT NULL,
    branch text,
    run_url text,
    evidence jsonb NOT NULL,
    token_id text NOT NULL REFERENCES api_tokens(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by text NOT NULL
  )`);
  pgm.sql(`CREATE INDEX ci_evidence_feature_idx ON ci_evidence (feature_id, created_at DESC)`);
  pgm.sql(`ALTER TABLE commits DROP CONSTRAINT commits_source_check`);
  pgm.sql(`ALTER TABLE commits ADD CONSTRAINT commits_source_check CHECK (source IN ('host', 'webhook', 'ci'))`);
  pgm.sql(`ALTER TABLE phase_transitions ADD COLUMN ci_evidence_id text REFERENCES ci_evidence(id), ADD COLUMN evidence_sources jsonb`);
};

export const down = (pgm) => {
  pgm.sql(`ALTER TABLE phase_transitions DROP COLUMN IF EXISTS ci_evidence_id, DROP COLUMN IF EXISTS evidence_sources`);
  pgm.sql(`UPDATE commits SET source = 'host' WHERE source = 'ci'`);
  pgm.sql(`ALTER TABLE commits DROP CONSTRAINT commits_source_check`);
  pgm.sql(`ALTER TABLE commits ADD CONSTRAINT commits_source_check CHECK (source IN ('host', 'webhook'))`);
  pgm.sql(`DROP TABLE IF EXISTS ci_evidence`);
};
