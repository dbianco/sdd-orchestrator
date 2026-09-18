export const shorthands = undefined;

const audit = `
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL`;

export const up = (pgm) => {
  pgm.sql(`CREATE TABLE routing_events (
    id text PRIMARY KEY,
    app_id text NOT NULL REFERENCES apps(id),
    identity_key text NOT NULL,
    external_ref text,
    trigger_ref text,
    task_description text NOT NULL,
    decision jsonb NOT NULL,
    intent text NOT NULL,
    framework text NOT NULL,
    lite boolean NOT NULL DEFAULT false,
    workspace jsonb,
    route_count integer NOT NULL DEFAULT 1,
    first_routed_at timestamptz NOT NULL DEFAULT now(),
    last_routed_at timestamptz NOT NULL DEFAULT now(),
    feature_id text REFERENCES features(id),
    ${audit},
    UNIQUE (app_id, identity_key)
  )`);
  pgm.sql(`CREATE INDEX routing_events_app_last_idx ON routing_events (app_id, last_routed_at DESC)`);
  pgm.sql(`CREATE INDEX routing_events_feature_idx ON routing_events (feature_id)`);

  pgm.sql(`CREATE TABLE commits (
    id text PRIMARY KEY,
    app_id text NOT NULL REFERENCES apps(id),
    sha text NOT NULL,
    branch text,
    message text NOT NULL,
    files_changed text[] NOT NULL DEFAULT '{}',
    committed_at timestamptz,
    routing_id text REFERENCES routing_events(id),
    feature_id text REFERENCES features(id),
    source text NOT NULL DEFAULT 'host' CHECK (source IN ('host', 'webhook')),
    ${audit},
    UNIQUE (app_id, sha),
    CHECK (routing_id IS NOT NULL OR feature_id IS NOT NULL)
  )`);
  pgm.sql(`CREATE INDEX commits_routing_idx ON commits (routing_id)`);
  pgm.sql(`CREATE INDEX commits_feature_idx ON commits (feature_id)`);
};

export const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS commits CASCADE`);
  pgm.sql(`DROP TABLE IF EXISTS routing_events CASCADE`);
};
