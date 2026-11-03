import { z } from 'zod';
import { finding, type CheckDefinition } from '../types.js';
import { taskBlocks } from './taskDoneChecks.js';

// dep_regex captures either one dependency in group "id" or a whole list in group "ids"; with "ids",
// every task id inside the list is found with id_regex (so "depends on T1, T2 and T3" checks all three).
const hasIdGroup = z.string().refine((s) => s.includes('(?<id>') || s.includes('(?<ids>'), { message: 'regex must contain named group "id" (or "ids" for dep_regex)' });
const withIdGroup = z.string().refine((s) => s.includes('(?<id>'), { message: 'regex must contain named group "id"' });
const Params = z.object({ artifact: z.string(), task_regex: withIdGroup, dep_regex: hasIdGroup, id_regex: z.string().optional() })
  .refine((p) => !p.dep_regex.includes('(?<ids>') || p.id_regex !== undefined, { message: 'id_regex is required when dep_regex uses group "ids"', path: ['id_regex'] });

export const taskOrdering: CheckDefinition = {
  name: 'task_ordering',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ artifacts, params, severity }) => {
    const p = Params.parse(params);
    const text = artifacts[p.artifact];
    if (text === undefined) return [];
    const dep = new RegExp(p.dep_regex, 'g');
    const idRe = p.id_regex ? new RegExp(p.id_regex, 'g') : null;
    const seen = new Set<string>();
    const out = [];
    for (const block of taskBlocks(text, new RegExp(p.task_regex))) {
      const id = block.match.groups?.id ?? '?';
      const body = block.lines.map((l) => l.text).join('\n');
      const reported = new Set<string>();
      for (const m of body.matchAll(dep)) {
        const deps = m.groups?.ids !== undefined && idRe ? [...m.groups.ids.matchAll(idRe)].map((x) => x[0]) : m.groups?.id ? [m.groups.id] : [];
        for (const depId of deps) {
          if (seen.has(depId) || reported.has(depId)) continue;
          reported.add(depId);
          out.push(finding('task_ordering', severity, `${p.artifact}:${block.startLine}`, `task ${id} depends on ${depId} which does not appear earlier`));
        }
      }
      seen.add(id);
    }
    return out;
  },
};
