import { z } from 'zod';
import { contentLines, findSection, parseSections } from '../markdown.js';
import { finding, type CheckDefinition } from '../types.js';

export const DEFAULT_ADJECTIVES: string[] = [
  'fast', 'quick', 'quickly', 'slow', 'responsive', 'scalable', 'performant', 'efficient', 'reliable', 'robust',
  'secure', 'easy', 'simple', 'intuitive', 'user-friendly', 'small', 'large', 'high', 'low', 'many', 'few',
  'soon', 'instant', 'instantly', 'minimal', 'maximum', 'optimal', 'better', 'improved', 'acceptable', 'reasonable',
];

// A bare number is not a threshold ("fast for 2 users"): it needs a unit, or a bound word or symbol in front.
const WITH_UNIT = /\d+(?:\.\d+)?\s*(?:ms|s|secs?|seconds?|mins?|minutes?|h|hrs?|hours?|days?|%|[KMGT]?B|req\/s|rps|qps)(?![\w/])/i;
const WITH_BOUND = /(?:[<>]=?|[≤≥]|\b(?:under|below|above|over|within|at most|at least|no more than|no less than|less than|more than|fewer than|up to|max(?:imum)?|min(?:imum)?)\b)\s*\d/i;

const Params = z.object({ artifact: z.string(), section: z.string(), adjectives: z.array(z.string()).optional() });

export const measurableCriteria: CheckDefinition = {
  name: 'measurable_criteria',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ artifacts, params, severity }) => {
    const p = Params.parse(params);
    const text = artifacts[p.artifact];
    if (text === undefined) return [];
    const section = findSection(parseSections(text), p.section);
    if (!section) return [];
    const adjectives = [...DEFAULT_ADJECTIVES, ...(p.adjectives ?? [])];
    const adjective = new RegExp(`\\b(?:${adjectives.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
    const out = [];
    for (const line of contentLines(section)) {
      if (adjective.test(line.text) && !WITH_UNIT.test(line.text) && !WITH_BOUND.test(line.text)) {
        const shown = line.text.replace(/^\s*[-*+]\s+|\s*\d+\.\s+/, '').trim();
        out.push(finding('measurable_criteria', severity, `${p.artifact}:${line.n}`, `"${shown}" has no threshold`));
      }
    }
    return out;
  },
};
