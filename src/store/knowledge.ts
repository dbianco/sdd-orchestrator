import type { Queryable } from '../db/pool.js';
import type { KnowledgeKind, MemoryType, Tier } from '../domain/types.js';
import { newId } from '../ids.js';
import type { KnowledgeItemRow } from './rows.js';

export interface NewKnowledgeItem {
  stable_id: string; kind: KnowledgeKind; tier: Tier; framework: string | null; app_id: string | null; memory_type: MemoryType | null;
  human_id: string | null; stack_tags: string[]; phase_tags: string[]; title: string; body: string; front_matter: Record<string, unknown>;
  pack_name: string; pack_version: string | null; source_path: string | null; source_hash: string | null; source_url: string | null; license: string | null;
}

export async function latestItem(q: Queryable, stableId: string): Promise<KnowledgeItemRow | null> {
  const r = await q.query<KnowledgeItemRow>('SELECT * FROM knowledge_items WHERE stable_id = $1 ORDER BY version DESC LIMIT 1', [stableId]);
  return r.rows[0] ?? null;
}

export async function currentItem(q: Queryable, stableId: string): Promise<KnowledgeItemRow | null> {
  const r = await q.query<KnowledgeItemRow>(
    `SELECT * FROM knowledge_items WHERE stable_id = $1 AND status = 'active' AND superseded_by IS NULL ORDER BY version DESC LIMIT 1`, [stableId]);
  return r.rows[0] ?? null;
}

export async function itemVersion(q: Queryable, stableId: string, version: number): Promise<KnowledgeItemRow | null> {
  const r = await q.query<KnowledgeItemRow>('SELECT * FROM knowledge_items WHERE stable_id = $1 AND version = $2', [stableId, version]);
  return r.rows[0] ?? null;
}

export async function itemById(q: Queryable, id: string): Promise<KnowledgeItemRow | null> {
  const r = await q.query<KnowledgeItemRow>('SELECT * FROM knowledge_items WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

export async function markSuperseded(q: Queryable, id: string, byId: string): Promise<void> {
  await q.query('UPDATE knowledge_items SET superseded_by = $2, updated_at = now() WHERE id = $1', [id, byId]);
}

export async function insertItemVersion(q: Queryable, item: NewKnowledgeItem, actor: string): Promise<KnowledgeItemRow> {
  const previous = await latestItem(q, item.stable_id);
  const current = await currentItem(q, item.stable_id);
  const version = (previous?.version ?? 0) + 1;
  const r = await q.query<KnowledgeItemRow>(
    `INSERT INTO knowledge_items (id, stable_id, version, kind, tier, framework, app_id, memory_type, human_id, stack_tags, phase_tags,
       title, body, front_matter, pack_name, pack_version, source_path, source_hash, source_url, license, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING *`,
    [newId('k'), item.stable_id, version, item.kind, item.tier, item.framework, item.app_id, item.memory_type, item.human_id,
      item.stack_tags, item.phase_tags, item.title, item.body, JSON.stringify(item.front_matter), item.pack_name, item.pack_version,
      item.source_path, item.source_hash, item.source_url, item.license, actor],
  );
  const row = r.rows[0]!;
  if (current) await markSuperseded(q, current.id, row.id);
  return row;
}

export async function deprecateItem(q: Queryable, stableId: string, successorStableId: string | null, reason: string, actor: string): Promise<KnowledgeItemRow> {
  void actor;
  const current = await currentItem(q, stableId);
  if (!current) throw new Error(`no current item with stable_id "${stableId}"`);
  const successor = successorStableId ? await currentItem(q, successorStableId) : null;
  if (successorStableId && !successor) throw new Error(`no current item with stable_id "${successorStableId}" to use as successor`);
  const r = await q.query<KnowledgeItemRow>(
    `UPDATE knowledge_items SET status = 'deprecated', deprecation_reason = $2, superseded_by = COALESCE($3, superseded_by), updated_at = now() WHERE id = $1 RETURNING *`,
    [current.id, reason, successor?.id ?? null],
  );
  return r.rows[0]!;
}

export async function listAlwaysOn(q: Queryable, appId: string | null): Promise<KnowledgeItemRow[]> {
  const r = await q.query<KnowledgeItemRow>(
    `SELECT * FROM knowledge_items
     WHERE kind = 'standard' AND tier = 'always_on' AND status = 'active' AND superseded_by IS NULL
       AND (app_id IS NULL OR app_id = $1)
     ORDER BY (app_id IS NOT NULL), stable_id`,
    [appId],
  );
  return r.rows;
}

export async function listActivePackItems(q: Queryable, packName: string): Promise<KnowledgeItemRow[]> {
  const r = await q.query<KnowledgeItemRow>(
    `SELECT * FROM knowledge_items WHERE pack_name = $1 AND status = 'active' AND superseded_by IS NULL ORDER BY stable_id`, [packName]);
  return r.rows;
}

export async function listStackGuidePacks(q: Queryable): Promise<{ pack_name: string; pack_version: string; stack_tags: string[] }[]> {
  const r = await q.query<{ pack_name: string; pack_version: string; stack_tags: string[] }>(
    `SELECT pack_name, pack_version, array_agg(DISTINCT tag ORDER BY tag) AS stack_tags
     FROM knowledge_items, unnest(stack_tags) AS tag
     WHERE kind = 'stack_guide' AND status = 'active' AND superseded_by IS NULL
     GROUP BY pack_name, pack_version ORDER BY pack_name`,
  );
  return r.rows;
}

export async function nextProposalSequence(q: Queryable, appSlug: string, key: string): Promise<number> {
  const prefix = `${appSlug}.${key}.`;
  const r = await q.query<{ n: number | null }>(
    `SELECT max((substring(stable_id FROM length($1) + 1))::int) AS n FROM knowledge_items
     WHERE starts_with(stable_id, $1) AND substring(stable_id FROM length($1) + 1) ~ '^[0-9]+$'`,
    [prefix],
  );
  return (r.rows[0]?.n ?? 0) + 1;
}
