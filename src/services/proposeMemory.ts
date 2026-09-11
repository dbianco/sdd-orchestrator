import type { MemoryType } from '../domain/types.js';
import { DomainError } from '../errors.js';
import { requireFeature } from '../store/features.js';
import { insertProposal } from '../store/proposals.js';
import type { ServiceDeps } from './deps.js';

export interface ProposeMemoryInput {
  feature_id: string; actor: string; kind: 'app_memory' | 'standard'; memory_type?: MemoryType | null; title: string; body: string;
  stack_tags?: string[]; links?: string[]; supersedes?: string | null;
}

export async function proposeMemory(deps: ServiceDeps, input: ProposeMemoryInput): Promise<{ proposal_id: string; status: 'pending' }> {
  if (input.kind === 'app_memory' && !input.memory_type) throw new DomainError('VALIDATION_ERROR', 'memory_type is required for app_memory proposals', { field: 'memory_type' });
  const feature = await requireFeature(deps.pool, input.feature_id);
  if (feature.status === 'archived') throw new DomainError('FEATURE_ARCHIVED', `feature ${feature.id} is archived`, { feature_id: feature.id });
  const row = await insertProposal(deps.pool, {
    app_id: feature.app_id, feature_id: feature.id, supersedes: input.supersedes ?? null,
    payload: { kind: input.kind, memory_type: input.memory_type ?? null, title: input.title, body: input.body, stack_tags: input.stack_tags ?? [], links: input.links ?? [] },
  }, input.actor);
  return { proposal_id: row.id, status: 'pending' };
}
