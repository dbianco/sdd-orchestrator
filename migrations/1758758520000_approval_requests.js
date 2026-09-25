export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`ALTER TABLE phase_transitions DROP CONSTRAINT phase_transitions_result_check`);
  pgm.sql(`ALTER TABLE phase_transitions ADD CONSTRAINT phase_transitions_result_check CHECK (result IN ('pass', 'fail', 'awaiting_approval'))`);
  pgm.sql(`CREATE TABLE approval_requests (
    id text PRIMARY KEY,
    feature_id text NOT NULL REFERENCES features(id),
    transition_id text NOT NULL REFERENCES phase_transitions(id),
    from_phase text NOT NULL,
    to_phase text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
    requested_by text NOT NULL,
    decided_by text,
    decided_at timestamptz,
    comment text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by text NOT NULL
  )`);
  pgm.sql(`CREATE UNIQUE INDEX approval_requests_one_pending ON approval_requests (feature_id) WHERE status = 'pending'`);
  pgm.sql(`CREATE INDEX approval_requests_status_idx ON approval_requests (status, created_at)`);
  pgm.sql(`ALTER TABLE phase_transitions ADD COLUMN approval_id text REFERENCES approval_requests(id), ADD COLUMN approved_by text`);
};

export const down = (pgm) => {
  pgm.sql(`ALTER TABLE phase_transitions DROP COLUMN IF EXISTS approval_id, DROP COLUMN IF EXISTS approved_by`);
  pgm.sql(`DROP TABLE IF EXISTS approval_requests`);
  pgm.sql(`DELETE FROM phase_transitions WHERE result = 'awaiting_approval'`);
  pgm.sql(`ALTER TABLE phase_transitions DROP CONSTRAINT phase_transitions_result_check`);
  pgm.sql(`ALTER TABLE phase_transitions ADD CONSTRAINT phase_transitions_result_check CHECK (result IN ('pass', 'fail'))`);
};
