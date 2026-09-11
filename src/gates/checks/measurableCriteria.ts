import { z } from 'zod';
import { contentLines, findSection, parseSections } from '../markdown.js';
import { finding, type CheckDefinition } from '../types.js';

export const DEFAULT_ADJECTIVES: string[] = [
  'fast', 'quick', 'quickly', 'slow', 'responsive', 'scalable', 'performant', 'efficient', 'reliable', 'robust',
  'secure', 'easy', 'simple', 'intuitive', 'user-friendly', 'small', 'large', 'high', 'low', 'many', 'few',
  'soon', 'instant', 'instantly', 'minimal', 'maximum', 'optimal', 'better', 'improved', 'acceptable', 'reasonable',
];

const MEASURE = /\d+(?:\.\d+)?\s*(?:ms|s|%|MB|GB|KB|req\/s|rps)\b|\b\d+\b/;

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
      if (adjective.test(line.text) && !MEASURE.test(line.text)) {
        const shown = line.text.replace(/^\s*[-*+]\s+|\s*\d+\.\s+/, '').trim();
        out.push(finding('measurable_criteria', severity, `${p.artifact}:${line.n}`, `"${shown}" has no threshold`));
      }
    }
    return out;
  },
};
