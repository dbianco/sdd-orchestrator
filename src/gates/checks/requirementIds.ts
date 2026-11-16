import { z } from 'zod';
import { regexParam } from '../regex.js';
import { finding, type CheckDefinition } from '../types.js';

const Params = z.object({
  artifact: z.string(),
  id_regex: regexParam('gm').refine((v) => v.includes('(?<id>'), 'must contain a named group "id"'),
  min: z.number().int().nonnegative().default(1),
});

export function extractRequirementIds(text: string, idRegex: string): { id: string; line: number }[] {
  const out: { id: string; line: number }[] = [];
  for (const m of text.matchAll(new RegExp(idRegex, 'gm'))) {
    const id = m.groups?.id?.trim();
    if (!id) continue;
    out.push({ id, line: text.slice(0, m.index).split('\n').length });
  }
  return out;
}

export const requirementIds: CheckDefinition = {
  name: 'requirement_ids',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ artifacts, params, severity }) => {
    const p = Params.parse(params);
    const text = artifacts[p.artifact];
    if (text === undefined) return [];
    const found = extractRequirementIds(text, p.id_regex);
    const out = [];
    const seen = new Set<string>();
    for (const r of found) {
      if (seen.has(r.id)) out.push(finding('requirement_ids', severity, `${p.artifact}:${r.line}`, `duplicate requirement id ${r.id}`));
      seen.add(r.id);
    }
    if (seen.size < p.min) out.push(finding('requirement_ids', severity, p.artifact, `found ${seen.size} requirement id(s) in ${p.artifact}, expected at least ${p.min}`));
    return out;
  },
};
