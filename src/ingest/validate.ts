import { PHASES, type TrackDecl } from '../domain/types.js';
import { validateGateDecl } from '../gates/library.js';
import { phaseTemplates, validateTrackSelection, validateTrackShape } from '../lifecycle/track.js';
import { countTokens } from '../tokens.js';
import { effectiveApp, effectiveKind, type LoadedPack } from './load.js';

export const ALWAYS_ON_WARN_TOKENS = 1200;
export const TEMPLATE_WARN_TOKENS = 3000;

export function validatePack(pack: LoadedPack, ctx: { knownAppSlugs: Set<string> }): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Map<string, string[]>();
  for (const item of pack.items) ids.set(item.frontMatter.id, [...(ids.get(item.frontMatter.id) ?? []), item.sourcePath]);
  for (const [id, paths] of ids) if (paths.length > 1) errors.push(`duplicate id "${id}" (${paths.join(', ')})`);
  for (const item of pack.items) {
    const s = item.frontMatter.supersedes;
    if (s && ids.has(s)) errors.push(`${item.frontMatter.id}: supersedes "${s}", which is still present in this pack (${ids.get(s)!.join(', ')}); remove that file or drop the supersedes`);
  }

  const alwaysOnTokens = new Map<string, number>();
  for (const item of pack.items) {
    const id = item.frontMatter.id;
    const kind = effectiveKind(pack, item);
    const app = effectiveApp(pack, item);
    if (item.frontMatter.tier === 'always_on' && kind !== 'standard') errors.push(`${id}: only standard items may be always_on`);
    if (kind === 'app_memory' && !app) errors.push(`${id}: app_memory items require app`);
    if (kind === 'app_memory' && !item.frontMatter.memory_type) errors.push(`${id}: app_memory items require memory_type`);
    if (app && !ctx.knownAppSlugs.has(app)) errors.push(`${id}: unknown app "${app}"`);
    if (!item.body.trim()) errors.push(`${id}: has no body`);
    if (item.frontMatter.tier === 'always_on') {
      const key = app ?? 'company';
      alwaysOnTokens.set(key, (alwaysOnTokens.get(key) ?? 0) + countTokens(item.body));
    }
  }
  for (const [key, tokens] of alwaysOnTokens) {
    if (tokens > ALWAYS_ON_WARN_TOKENS) warnings.push(`always-on standards for ${key} total ${tokens} tokens, above ${ALWAYS_ON_WARN_TOKENS}`);
  }

  if (pack.manifest.kind === 'framework_pack') {
    if (pack.manifest.framework && pack.manifest.framework !== pack.manifest.name) {
      errors.push(`framework pack declares framework "${pack.manifest.framework}" but pack name "${pack.manifest.name}"; retrieval pins framework items by pack name, so they must match`);
    }
    if (!pack.manifest.tracks || Object.keys(pack.manifest.tracks).length === 0) {
      errors.push('framework packs must declare tracks');
    } else {
      for (const [name, track] of Object.entries(pack.manifest.tracks) as [string, TrackDecl][]) {
        for (const e of validateTrackShape(track)) errors.push(`track ${name}: ${e}`);
        for (const phase of PHASES) {
          const entry = track.phases[phase];
          if (entry === 'skipped') continue;
          if (entry.template && entry.templates) errors.push(`track ${name}: phase ${phase} declares both template and templates`);
          const templates = phaseTemplates(entry);
          let total = 0;
          for (const id of templates) {
            const item = pack.items.find((i) => i.frontMatter.id === id);
            if (!item) { errors.push(`track ${name}: phase ${phase} names template "${id}" which is not in this pack`); continue; }
            total += countTokens(item.body);
          }
          if (total > TEMPLATE_WARN_TOKENS) {
            const msg = templates.length === 1
              ? `template ${templates[0]} is ${total} tokens, above ${TEMPLATE_WARN_TOKENS}`
              : `templates for phase ${phase} total ${total} tokens, above ${TEMPLATE_WARN_TOKENS}`;
            if (!warnings.includes(msg)) warnings.push(msg);
          }
        }
        for (const gate of track.gates) for (const e of validateGateDecl(gate)) errors.push(`track ${name} gate ${gate.transition}: ${e}`);
      }
      errors.push(...validateTrackSelection(pack.manifest.tracks as Record<string, TrackDecl>));
    }
  } else if (pack.manifest.tracks) {
    warnings.push('tracks are ignored on non-framework packs');
  }
  return { errors, warnings };
}
