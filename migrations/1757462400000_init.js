export const shorthands = undefined;

const audit = `
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL`;

export const up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS vector`);
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  pgm.sql(`CREATE TABLE apps (
    id text PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    default_stack text[] NOT NULL DEFAULT '{}',
    compliance boolean NOT NULL DEFAULT false,
    token_budget integer,
    min_similarity real,
    stop_conditions text[] NOT NULL DEFAULT '{}',
    ${audit}
  )`);

  pgm.sql(`CREATE TABLE app_policies (
    id text PRIMARY KEY,
    app_id text NOT NULL REFERENCES apps(id),
    version integer NOT NULL,
    policy jsonb NOT NULL,
    reason text NOT NULL,
    ${audit},
    UNIQUE (app_id, version)
  )`);

  pgm.sql(`CREATE TABLE frameworks (
    id text PRIMARY KEY,
    name text NOT NULL,
    pack_version text NOT NULL,
    tracks jsonb NOT NULL,
    gate_library_version text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
    ${audit},
    UNIQUE (name, pack_version)
  )`);

  pgm.sql(`CREATE TABLE embedding_config (
    id text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
    provider text NOT NULL,
    model text NOT NULL,
    dimension integer NOT NULL,
    reindexed_at timestamptz,
    ${audit}
  )`);

  pgm.sql(`CREATE TABLE features (
    id text PRIMARY KEY,
    app_id text NOT NULL REFERENCES apps(id),
    slug text NOT NULL,
    intent text NOT NULL,
    framework text NOT NULL,
    framework_pack_version text NOT NULL,
    track text,
    current_phase text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'archived')),
    blocked_reason text,
    high_risk boolean NOT NULL DEFAULT false,
    failed_cycles integer NOT NULL DEFAULT 0,
    policy_version integer,
    policy_override_reason text,
    source_task text NOT NULL,
    external_ref text,
    trigger_ref text,
    decision jsonb NOT NULL,
    workspace jsonb,
    ${audit},
    UNIQUE (app_id, slug)
  )`);
  pgm.sql(`CREATE INDEX features_app_status_idx ON features (app_id, status)`);
  pgm.sql(`CREATE INDEX features_external_ref_idx ON features (external_ref)`);

  pgm.sql(`CREATE TABLE context_packs (
    id text PRIMARY KEY,
    feature_id text NOT NULL REFERENCES features(id),
    phase text NOT NULL,
    scope jsonb NOT NULL,
    focus text,
    items jsonb NOT NULL,
    rendered text NOT NULL,
    token_count integer NOT NULL,
    budget integer NOT NULL,
    degraded boolean NOT NULL DEFAULT false,
    over_budget boolean NOT NULL DEFAULT false,
    ${audit}
  )`);
  pgm.sql(`CREATE INDEX context_packs_feature_phase_idx ON context_packs (feature_id, phase, created_at DESC)`);

  pgm.sql(`CREATE TABLE phase_transitions (
    id text PRIMARY KEY,
    feature_id text NOT NULL REFERENCES features(id),
    from_phase text NOT NULL,
    to_phase text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('forward', 'backward')),
    result text NOT NULL CHECK (result IN ('pass', 'fail')),
    findings jsonb NOT NULL DEFAULT '[]',
    evidence jsonb,
    pack_id text REFERENCES context_packs(id),
    artifact_hashes jsonb NOT NULL DEFAULT '{}',
    human_approved boolean NOT NULL DEFAULT false,
    reason text,
    ${audit}
  )`);
  pgm.sql(`CREATE INDEX phase_transitions_feature_idx ON phase_transitions (feature_id, created_at)`);

  pgm.sql(`CREATE TABLE feature_artifacts (
    id text PRIMARY KEY,
    transition_id text NOT NULL REFERENCES phase_transitions(id),
    name text NOT NULL,
    sha256 text NOT NULL,
    byte_length integer NOT NULL,
    content text,
    ${audit}
  )`);

  pgm.sql(`CREATE TABLE knowledge_items (
    id text PRIMARY KEY,
    stable_id text NOT NULL,
    version integer NOT NULL,
    kind text NOT NULL CHECK (kind IN ('framework_pack', 'standard', 'stack_guide', 'app_memory')),
    tier text NOT NULL CHECK (tier IN ('always_on', 'retrieved')),
    framework text,
    app_id text REFERENCES apps(id),
    memory_type text CHECK (memory_type IN ('adr', 'decision', 'constraint', 'incident')),
    human_id text,
    stack_tags text[] NOT NULL DEFAULT '{}',
    phase_tags text[] NOT NULL DEFAULT '{}',
    title text NOT NULL,
    body text NOT NULL,
    front_matter jsonb NOT NULL DEFAULT '{}',
    pack_name text NOT NULL,
    pack_version text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
    superseded_by text REFERENCES knowledge_items(id),
    deprecation_reason text,
    source_path text,
    source_hash text,
    source_url text,
    license text,
    ${audit},
    UNIQUE (stable_id, version)
  )`);
  pgm.sql(`CREATE INDEX knowledge_items_current_idx ON knowledge_items (stable_id) WHERE status = 'active' AND superseded_by IS NULL`);
  pgm.sql(`CREATE INDEX knowledge_items_pack_idx ON knowledge_items (pack_name, pack_version)`);
  pgm.sql(`CREATE INDEX knowledge_items_human_id_idx ON knowledge_items (human_id)`);
  pgm.sql(`CREATE INDEX knowledge_items_title_trgm ON knowledge_items USING gin (title gin_trgm_ops)`);

  pgm.sql(`CREATE TABLE knowledge_chunks (
    id text PRIMARY KEY,
    item_id text NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    ordinal integer NOT NULL,
    heading_path text NOT NULL,
    text text NOT NULL,
    embedding vector(1024) NOT NULL,
    embedding_model text NOT NULL,
    token_count integer NOT NULL,
    tokenizer text NOT NULL,
    ${audit},
    UNIQUE (item_id, ordinal)
  )`);
  pgm.sql(`CREATE INDEX knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)`);
  pgm.sql(`CREATE INDEX knowledge_chunks_text_trgm ON knowledge_chunks USING gin (text gin_trgm_ops)`);

  pgm.sql(`CREATE TABLE proposals (
    id text PRIMARY KEY,
    app_id text NOT NULL REFERENCES apps(id),
    feature_id text NOT NULL REFERENCES features(id),
    payload jsonb NOT NULL,
    supersedes text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by text,
    review_reason text,
    ${audit}
  )`);
};

export const down = (pgm) => {
  for (const t of ['proposals', 'knowledge_chunks', 'knowledge_items', 'feature_artifacts', 'phase_transitions',
    'context_packs', 'features', 'embedding_config', 'frameworks', 'app_policies', 'apps']) {
    pgm.sql(`DROP TABLE IF EXISTS ${t} CASCADE`);
  }
};
