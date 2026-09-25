import { z } from 'zod';
import { finding, type CheckDefinition } from '../types.js';

const normalize = (s: string): string => s.trim().toLowerCase();

export const requirementCoverage: CheckDefinition = {
  name: 'requirement_coverage',
  defaultSeverity: 'blocker',
  params: z.object({}).passthrough(),
  run: ({ evidence, requirements = [], severity }) => {
    const name = 'requirement_coverage';
    if (requirements.length === 0) return [finding(name, 'warning', null, 'no requirements were captured for this feature; coverage not checked')];
    const raw = (evidence as { implements?: unknown } | null)?.implements;
    const implemented = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    const covered = new Set(implemented.map(normalize));
    const known = new Set(requirements.map(normalize));
    const out = requirements
      .filter((r) => !covered.has(normalize(r)))
      .map((r) => finding(name, severity, r, `${r} is not covered by evidence.implements`));
    for (const id of implemented) {
      if (!known.has(normalize(id))) out.push(finding(name, 'warning', id.trim(), `${id.trim()} in evidence.implements is not a requirement of this feature`));
    }
    return out;
  },
};
