import { z } from 'zod';
import { finding, type CheckDefinition } from '../types.js';
import { taskBlocks } from './taskDoneChecks.js';

// Cross-artifact consistency: the requirements captured at the spec gate must each be referenced by a task,
// and every requirement a task cites must exist. ref_regex finds citations inside a task block, either one id
// in group "id" or a list in group "ids" (then id_regex extracts each id), like task_ordering's dep_regex.
const hasRefGroup = z.string().refine((s) => s.includes('(?<id>') || s.includes('(?<ids>'), { message: 'ref_regex must contain named group "id" or "ids"' });
const withIdGroup = z.string().refine((s) => s.includes('(?<id>'), { message: 'task_regex must contain named group "id"' });
const Params = z.object({ artifact: z.string(), task_regex: withIdGroup, ref_regex: hasRefGroup, id_regex: z.string().optional() })
  .refine((p) => !p.ref_regex.includes('(?<ids>') || p.id_regex !== undefined, { message: 'id_regex is required when ref_regex uses group "ids"', path: ['id_regex'] });

const normalize = (s: string): string => s.trim().toLowerCase();

export const artifactTraceability: CheckDefinition = {
  name: 'artifact_traceability',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ artifacts, params, severity, requirements = [] }) => {
    const p = Params.parse(params);
    const text = artifacts[p.artifact];
    if (text === undefined) return [];
    if (requirements.length === 0) return [finding('artifact_traceability', 'warning', null, 'no requirements were captured for this feature; spec-to-tasks traceability not checked')];
    const known = new Map(requirements.map((r) => [normalize(r), r]));
    const ref = new RegExp(p.ref_regex, 'g');
    const idRe = p.id_regex ? new RegExp(p.id_regex, 'g') : null;
    const referenced = new Set<string>();
    const out = [];
    for (const block of taskBlocks(text, new RegExp(p.task_regex))) {
      const taskId = block.match.groups?.id ?? '?';
      const body = block.lines.map((l) => l.text).join('\n');
      const unknown = new Set<string>();
      for (const m of body.matchAll(ref)) {
        const ids = m.groups?.ids !== undefined && idRe ? [...m.groups.ids.matchAll(idRe)].map((x) => x[0]) : m.groups?.id ? [m.groups.id] : [];
        for (const id of ids) {
          if (known.has(normalize(id))) referenced.add(normalize(id));
          else unknown.add(id.trim());
        }
      }
      for (const id of unknown) out.push(finding('artifact_traceability', severity, `${p.artifact}:${block.startLine}`, `task ${taskId} references ${id}, which is not a requirement of this feature`));
    }
    for (const [key, original] of known) {
      if (!referenced.has(key)) out.push(finding('artifact_traceability', severity, original, `${original} is not referenced by any task in ${p.artifact}`));
    }
    return out;
  },
};
