import { DomainError } from '../errors.js';
import { requireApp } from '../store/apps.js';
import { upsertCommit } from '../store/commits.js';
import { requireFeature } from '../store/features.js';
import { findRoutingEventByFeature, findRoutingEventByIdentity, identityKey, requireRoutingEvent } from '../store/routingEvents.js';
import type { ServiceDeps } from './deps.js';

export interface RecordCommitInput {
  app: string; actor: string; sha: string; message: string; branch?: string | null; files_changed?: string[] | null; committed_at?: string | null;
  routing_id?: string | null; feature_id?: string | null; external_ref?: string | null;
}
export interface RecordCommitResult { commit_id: string; routing_id: string | null; feature_id: string | null; deduplicated: boolean }

export async function recordCommit(deps: ServiceDeps, input: RecordCommitInput): Promise<RecordCommitResult> {
  const q = deps.pool;
  const app = await requireApp(q, input.app);
  const anchors = [input.routing_id, input.feature_id, input.external_ref].filter((a) => a != null && a !== '').length;
  if (anchors !== 1) {
    throw new DomainError('VALIDATION_ERROR', 'record_commit needs exactly one of routing_id, feature_id or external_ref', { field: 'routing_id' });
  }
  let routingId: string | null = null;
  let featureId: string | null = null;
  if (input.feature_id) {
    const feature = await requireFeature(q, input.feature_id);
    if (feature.app_id !== app.id) throw new DomainError('VALIDATION_ERROR', `feature ${feature.id} belongs to another app`, { field: 'feature_id' });
    featureId = feature.id;
    routingId = (await findRoutingEventByFeature(q, feature.id))?.id ?? null;
  } else if (input.routing_id) {
    const event = await requireRoutingEvent(q, input.routing_id);
    if (event.app_id !== app.id) throw new DomainError('VALIDATION_ERROR', `routing event ${event.id} belongs to another app`, { field: 'routing_id' });
    routingId = event.id;
    featureId = event.feature_id;
  } else {
    const event = await findRoutingEventByIdentity(q, app.id, identityKey(input.external_ref, ''));
    if (!event) {
      throw new DomainError('VALIDATION_ERROR', `no routing event for ${input.external_ref} in ${app.slug}; call route_task first or pass routing_id`, { field: 'external_ref' });
    }
    routingId = event.id;
    featureId = event.feature_id;
  }
  const { row, deduplicated } = await upsertCommit(q, {
    app_id: app.id, sha: input.sha, branch: input.branch ?? null, message: input.message, files_changed: input.files_changed ?? [],
    committed_at: input.committed_at ? new Date(input.committed_at) : null, routing_id: routingId, feature_id: featureId,
  }, input.actor);
  return { commit_id: row.id, routing_id: row.routing_id, feature_id: row.feature_id, deduplicated };
}
