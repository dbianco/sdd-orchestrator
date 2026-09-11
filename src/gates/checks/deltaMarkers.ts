import { z } from 'zod';
import { findSection, isNonEmpty, normalizeHeading, parseSections, type Section } from '../markdown.js';
import { finding, type CheckDefinition } from '../types.js';

const Params = z.object({ artifact: z.string() });
const REQUIRED_MARKERS = ['**Reason**', '**Migration**'];

export const deltaMarkers: CheckDefinition = {
  name: 'delta_markers',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ artifacts, params, severity }) => {
    const p = Params.parse(params);
    const text = artifacts[p.artifact];
    if (text === undefined) return [];
    const sections = parseSections(text);
    const added = findSection(sections, 'ADDED Requirements');
    const modified = findSection(sections, 'MODIFIED Requirements');
    const removed = findSection(sections, 'REMOVED Requirements');
    if (!added && !modified && !removed) {
      return [finding('delta_markers', severity, p.artifact, 'no ADDED, MODIFIED or REMOVED Requirements section found')];
    }
    if (!removed || !isNonEmpty(removed)) return [];

    const entries: Section[] = sections.filter(
      (s) => s.level > removed.level && s.startLine > removed.startLine && s.startLine <= removed.endLine
        && normalizeHeading(s.heading) !== normalizeHeading(removed.heading),
    );
    const out: ReturnType<typeof finding>[] = [];
    const checkEntry = (label: string, line: number, body: string) => {
      for (const marker of REQUIRED_MARKERS) {
        if (!body.includes(marker)) out.push(finding('delta_markers', severity, `${p.artifact}:${line}`, `removed requirement "${label}" lacks ${marker}`));
      }
    };
    if (entries.length === 0) {
      checkEntry('(unnamed)', removed.startLine, removed.body.map((l) => l.text).join('\n'));
    } else {
      for (const e of entries) checkEntry(e.heading, e.startLine, e.body.map((l) => l.text).join('\n'));
    }
    return out;
  },
};
