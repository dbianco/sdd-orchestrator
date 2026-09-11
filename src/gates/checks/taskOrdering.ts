import { z } from 'zod';
import { finding, type CheckDefinition } from '../types.js';
import { taskBlocks } from './taskDoneChecks.js';

const withIdGroup = z.string().refine((s) => s.includes('(?<id>'), { message: 'regex must contain named group "id"' });
const Params = z.object({ artifact: z.string(), task_regex: withIdGroup, dep_regex: withIdGroup });

export const taskOrdering: CheckDefinition = {
  name: 'task_ordering',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ artifacts, params, severity }) => {
    const p = Params.parse(params);
    const text = artifacts[p.artifact];
    if (text === undefined) return [];
    const dep = new RegExp(p.dep_regex, 'g');
    const seen = new Set<string>();
    const out = [];
    for (const block of taskBlocks(text, new RegExp(p.task_regex))) {
      const id = block.match.groups?.id ?? '?';
      const body = block.lines.map((l) => l.text).join('\n');
      for (const m of body.matchAll(dep)) {
        const depId = m.groups?.id;
        if (depId && !seen.has(depId)) {
          out.push(finding('task_ordering', severity, `${p.artifact}:${block.startLine}`, `task ${id} depends on ${depId} which does not appear earlier`));
        }
      }
      seen.add(id);
    }
    return out;
  },
};
