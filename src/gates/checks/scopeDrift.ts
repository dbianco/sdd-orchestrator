import { z } from 'zod';
import { findSection, parseSections } from '../markdown.js';
import { finding, type CheckDefinition } from '../types.js';

const Params = z.object({ plan_artifact: z.string(), files_section: z.string() });
const BACKTICKED = /`([^`]+)`/g;
const BARE = /[\w./-]+\.\w+/g;

export function extractPaths(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(BACKTICKED)) out.add(m[1]!.trim());
  for (const m of text.matchAll(BARE)) out.add(m[0]);
  return out;
}

export const scopeDrift: CheckDefinition = {
  name: 'scope_drift',
  defaultSeverity: 'warning',
  params: Params,
  run: ({ artifacts, evidence, params, severity }) => {
    const p = Params.parse(params);
    const plan = artifacts[p.plan_artifact];
    const files = (evidence as { files_changed?: unknown } | null)?.files_changed;
    if (plan === undefined || !Array.isArray(files) || files.length === 0) return [];
    const section = findSection(parseSections(plan), p.files_section);
    if (!section) return [];
    const listed = extractPaths(section.body.map((l) => l.text).join('\n'));
    return files
      .filter((f): f is string => typeof f === 'string' && !listed.has(f))
      .map((f) => finding('scope_drift', severity, f, `${f} is not listed in ${p.plan_artifact} section "${p.files_section}"`));
  },
};
