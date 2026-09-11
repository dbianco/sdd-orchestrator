import type { Queryable } from '../db/pool.js';
import type { Phase, Scope } from '../domain/types.js';
import { newId } from '../ids.js';
import type { ContextPackRow } from './rows.js';

export interface NewPack {
  feature_id: string; phase: Phase; scope: Scope; focus: string | null; items: { stable_id: string; version: number }[];
  rendered: string; token_count: number; budget: number; degraded: boolean; over_budget: boolean;
}

export async function insertPack(q: Queryable, p: NewPack, actor: string): Promise<ContextPackRow> {
  const r = await q.query<ContextPackRow>(
    `INSERT INTO context_packs (id, feature_id, phase, scope, focus, items, rendered, token_count, budget, degraded, over_budget, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [newId('cp'), p.feature_id, p.phase, JSON.stringify(p.scope), p.focus, JSON.stringify(p.items), p.rendered, p.token_count, p.budget, p.degraded, p.over_budget, actor],
  );
  return r.rows[0]!;
}

export async function getPack(q: Queryable, id: string): Promise<ContextPackRow | null> {
  const r = await q.query<ContextPackRow>('SELECT * FROM context_packs WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

export async function latestPack(q: Queryable, featureId: string, phase: Phase): Promise<ContextPackRow | null> {
  const r = await q.query<ContextPackRow>('SELECT * FROM context_packs WHERE feature_id = $1 AND phase = $2 ORDER BY created_at DESC, id DESC LIMIT 1', [featureId, phase]);
  return r.rows[0] ?? null;
}

export async function latestPackPerPhase(q: Queryable, featureId: string): Promise<Record<string, string>> {
  const r = await q.query<{ phase: string; id: string }>(
    'SELECT DISTINCT ON (phase) phase, id FROM context_packs WHERE feature_id = $1 ORDER BY phase, created_at DESC, id DESC', [featureId]);
  return Object.fromEntries(r.rows.map((x) => [x.phase, x.id]));
}
