import { createHash } from 'node:crypto';
import type { Queryable } from '../db/pool.js';
import type { Decision, Workspace } from '../domain/types.js';
import { DomainError } from '../errors.js';
import { newId } from '../ids.js';
import type { RoutingEventRow } from './rows.js';

export function identityKey(externalRef: string | null | undefined, taskDescription: string): string {
  const ref = externalRef?.trim();
  if (ref) return `ticket:${ref.toUpperCase()}`;
  const normalized = taskDescription.toLowerCase().trim().replace(/\s+/g, ' ');
  return `text:${createHash('sha256').update(normalized).digest('hex')}`;
}

export interface RoutingEventInput {
  app_id: string; external_ref: string | null; trigger_ref: string | null; task_description: string;
  decision: Decision; lite: boolean; workspace: Workspace | null;
}

export async function upsertRoutingEvent(q: Queryable, e: RoutingEventInput, actor: string, opts: { countRoute: boolean }): Promise<RoutingEventRow> {
  const key = identityKey(e.external_ref, e.task_description);
  const r = await q.query<RoutingEventRow>(
    `INSERT INTO routing_events (id, app_id, identity_key, external_ref, trigger_ref, task_description, decision, intent, framework, lite, workspace, route_count, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::int, $13)
     ON CONFLICT (app_id, identity_key) DO UPDATE SET
       external_ref = COALESCE(EXCLUDED.external_ref, routing_events.external_ref),
       trigger_ref = COALESCE(EXCLUDED.trigger_ref, routing_events.trigger_ref),
       task_description = EXCLUDED.task_description,
       decision = EXCLUDED.decision, intent = EXCLUDED.intent, framework = EXCLUDED.framework, lite = EXCLUDED.lite,
       workspace = EXCLUDED.workspace,
       route_count = routing_events.route_count + $12::int,
       last_routed_at = CASE WHEN $12::int > 0 THEN now() ELSE routing_events.last_routed_at END,
       updated_at = now()
     RETURNING *`,
    [newId('r'), e.app_id, key, e.external_ref, e.trigger_ref, e.task_description, JSON.stringify(e.decision), e.decision.intent, e.decision.framework,
      e.lite, e.workspace ? JSON.stringify(e.workspace) : null, opts.countRoute ? 1 : 0, actor],
  );
  return r.rows[0]!;
}

export async function getRoutingEvent(q: Queryable, id: string): Promise<RoutingEventRow | null> {
  const r = await q.query<RoutingEventRow>('SELECT * FROM routing_events WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

export async function requireRoutingEvent(q: Queryable, id: string): Promise<RoutingEventRow> {
  const e = await getRoutingEvent(q, id);
  if (!e) throw new DomainError('ROUTING_EVENT_NOT_FOUND', `no routing event with id "${id}"`, { routing_id: id });
  return e;
}

export async function findRoutingEventByIdentity(q: Queryable, appId: string, key: string): Promise<RoutingEventRow | null> {
  const r = await q.query<RoutingEventRow>('SELECT * FROM routing_events WHERE app_id = $1 AND identity_key = $2', [appId, key]);
  return r.rows[0] ?? null;
}

export async function findRoutingEventByFeature(q: Queryable, featureId: string): Promise<RoutingEventRow | null> {
  const r = await q.query<RoutingEventRow>('SELECT * FROM routing_events WHERE feature_id = $1', [featureId]);
  return r.rows[0] ?? null;
}

export async function linkRoutingEventToFeature(q: Queryable, routingId: string, featureId: string): Promise<RoutingEventRow> {
  const r = await q.query<RoutingEventRow>(
    'UPDATE routing_events SET feature_id = $2, updated_at = now() WHERE id = $1 AND feature_id IS NULL RETURNING *',
    [routingId, featureId],
  );
  if (!r.rows[0]) throw new DomainError('VALIDATION_ERROR', `routing event ${routingId} already belongs to another feature`, { field: 'routing_id' });
  return r.rows[0];
}

export interface RoutingFilter { appId: string | null; from: Date | null; to: Date | null }
export interface RoutingEventListRow extends RoutingEventRow {
  app_slug: string; feature_slug: string | null; feature_status: string | null; feature_phase: string | null; commit_count: number;
}

const FILTER = `($1::text IS NULL OR e.app_id = $1) AND ($2::timestamptz IS NULL OR e.last_routed_at >= $2) AND ($3::timestamptz IS NULL OR e.first_routed_at <= $3)`;

export async function listRoutingEvents(q: Queryable, f: RoutingFilter & { limit: number }): Promise<RoutingEventListRow[]> {
  const r = await q.query<RoutingEventListRow>(
    `SELECT e.*, a.slug AS app_slug, f.slug AS feature_slug, f.status AS feature_status, f.current_phase AS feature_phase,
       (SELECT count(*)::int FROM commits c WHERE c.routing_id = e.id OR (e.feature_id IS NOT NULL AND c.feature_id = e.feature_id)) AS commit_count
     FROM routing_events e
     JOIN apps a ON a.id = e.app_id
     LEFT JOIN features f ON f.id = e.feature_id
     WHERE ${FILTER}
     ORDER BY e.last_routed_at DESC LIMIT $4`,
    [f.appId, f.from, f.to, f.limit],
  );
  return r.rows;
}

export async function requireRoutingEventDetail(q: Queryable, id: string): Promise<RoutingEventListRow> {
  const r = await q.query<RoutingEventListRow>(
    `SELECT e.*, a.slug AS app_slug, f.slug AS feature_slug, f.status AS feature_status, f.current_phase AS feature_phase,
       (SELECT count(*)::int FROM commits c WHERE c.routing_id = e.id OR (e.feature_id IS NOT NULL AND c.feature_id = e.feature_id)) AS commit_count
     FROM routing_events e
     JOIN apps a ON a.id = e.app_id
     LEFT JOIN features f ON f.id = e.feature_id
     WHERE e.id = $1`,
    [id],
  );
  if (!r.rows[0]) throw new DomainError('ROUTING_EVENT_NOT_FOUND', `no routing event with id "${id}"`, { routing_id: id });
  return r.rows[0];
}

export async function routingSummary(q: Queryable, f: RoutingFilter): Promise<{ intent: string; count: number }[]> {
  const r = await q.query<{ intent: string; count: number }>(
    `SELECT e.intent, count(*)::int AS count FROM routing_events e WHERE ${FILTER} GROUP BY e.intent ORDER BY count DESC, e.intent`,
    [f.appId, f.from, f.to],
  );
  return r.rows;
}
