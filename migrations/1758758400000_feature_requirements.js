export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`CREATE TABLE feature_requirements (
    feature_id text NOT NULL REFERENCES features(id),
    req_id text NOT NULL,
    artifact text NOT NULL,
    line integer NOT NULL,
    transition_id text NOT NULL REFERENCES phase_transitions(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by text NOT NULL,
    PRIMARY KEY (feature_id, req_id)
  )`);
};

export const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS feature_requirements`);
};
