import type { Queryable } from '../db/pool.js';
import { DomainError } from '../errors.js';
import { newId } from '../ids.js';
import type { AppRow } from './rows.js';

export async function getAppBySlug(q: Queryable, slug: string): Promise<AppRow | null> {
  const r = await q.query<AppRow>('SELECT * FROM apps WHERE slug = $1', [slug]);
  return r.rows[0] ?? null;
}

export async function requireApp(q: Queryable, slug: string): Promise<AppRow> {
  const app = await getAppBySlug(q, slug);
  if (!app) throw new DomainError('APP_NOT_FOUND', `no app with slug "${slug}"`, { app: slug });
  return app;
}

export async function createApp(
  q: Queryable,
  input: { slug: string; name: string; compliance?: boolean; default_stack?: string[] },
  actor: string,
): Promise<AppRow> {
  const r = await q.query<AppRow>(
    `INSERT INTO apps (id, slug, name, compliance, default_stack, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [newId('a'), input.slug, input.name, input.compliance ?? false, input.default_stack ?? [], actor],
  );
  return r.rows[0]!;
}

export async function updateApp(
  q: Queryable,
  slug: string,
  patch: { default_stack?: string[]; token_budget?: number | null; min_similarity?: number | null },
  actor: string,
): Promise<AppRow> {
  await requireApp(q, slug);
  const r = await q.query<AppRow>(
    `UPDATE apps SET
       default_stack = COALESCE($2::text[], default_stack),
       token_budget = CASE WHEN $3::boolean THEN $4::int ELSE token_budget END,
       min_similarity = CASE WHEN $5::boolean THEN $6::real ELSE min_similarity END,
       updated_at = now()
     WHERE slug = $1 RETURNING *`,
    [slug, patch.default_stack ?? null, 'token_budget' in patch, patch.token_budget ?? null, 'min_similarity' in patch, patch.min_similarity ?? null],
  );
  void actor;
  return r.rows[0]!;
}

export async function addStopCondition(q: Queryable, slug: string, text: string, actor: string): Promise<AppRow> {
  await requireApp(q, slug);
  const r = await q.query<AppRow>(
    `UPDATE apps SET stop_conditions = array_append(stop_conditions, $2), updated_at = now() WHERE slug = $1 RETURNING *`,
    [slug, text],
  );
  void actor;
  return r.rows[0]!;
}

export async function listApps(q: Queryable): Promise<(AppRow & { policy_version: number | null })[]> {
  const r = await q.query<AppRow & { policy_version: number | null }>(
    `SELECT a.*, (SELECT max(version) FROM app_policies p WHERE p.app_id = a.id) AS policy_version FROM apps a ORDER BY a.slug`,
  );
  return r.rows;
}
