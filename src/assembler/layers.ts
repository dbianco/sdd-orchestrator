import type { Queryable } from '../db/pool.js';
import type { AttachedLayer, Scope } from '../domain/types.js';
import { DomainError } from '../errors.js';
import { getAppBySlug } from '../store/apps.js';
import { listActivePackItems, listStackGuidePacks } from '../store/knowledge.js';
import type { AppRow } from '../store/rows.js';

export const QUALITY_LAYER_PACK = 'quality-layer';

// Stack-guide packs select by intersection with workspace.stack, falling back to apps.default_stack
// whenever the workspace stack is absent OR empty (an empty array is the ordinary result of a host
// that ran stack detection and found nothing — it must fall back just like null/undefined would).
export function resolveStack(workspaceStack: string[] | null | undefined, defaultStack: string[]): string[] {
  return workspaceStack && workspaceStack.length > 0 ? workspaceStack : defaultStack;
}

export async function attachedLayers(q: Queryable, stack: string[]): Promise<{ layers: AttachedLayer[]; warnings: string[] }> {
  const layers: AttachedLayer[] = [];
  const warnings: string[] = [];
  const quality = await listActivePackItems(q, QUALITY_LAYER_PACK);
  if (quality.length > 0) layers.push({ pack_name: QUALITY_LAYER_PACK, pack_version: quality[0]!.pack_version ?? '0', kind: 'standard' });
  else warnings.push(`quality layer pack "${QUALITY_LAYER_PACK}" is not ingested`);
  const wanted = new Set(stack.map((s) => s.toLowerCase()));
  for (const pack of await listStackGuidePacks(q)) {
    if (pack.stack_tags.some((t) => wanted.has(t.toLowerCase()))) layers.push({ pack_name: pack.pack_name, pack_version: pack.pack_version, kind: 'stack_guide' });
  }
  return { layers, warnings };
}

export async function resolveScope(q: Queryable, scope: Scope, app: AppRow): Promise<'company' | { appIds: string[] }> {
  if (scope === 'company') return 'company';
  if (scope === 'app') return { appIds: [app.id] };
  const ids: string[] = [];
  for (const slug of scope) {
    const row = await getAppBySlug(q, slug);
    if (!row) throw new DomainError('APP_NOT_FOUND', `scope names unknown app "${slug}"`, { app: slug });
    ids.push(row.id);
  }
  return { appIds: ids };
}
