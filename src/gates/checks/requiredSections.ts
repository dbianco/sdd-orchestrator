import { z } from 'zod';
import { findSection, isNonEmpty, parseSections } from '../markdown.js';
import { finding, type CheckDefinition } from '../types.js';

const Params = z.object({ artifact: z.string(), sections: z.array(z.string()).min(1) });

export const requiredSections: CheckDefinition = {
  name: 'required_sections',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ artifacts, params, severity }) => {
    const p = Params.parse(params);
    const text = artifacts[p.artifact];
    if (text === undefined) return [];
    const sections = parseSections(text);
    const out = [];
    for (const name of p.sections) {
      const s = findSection(sections, name);
      if (!s) out.push(finding('required_sections', severity, p.artifact, `section "${name}" is missing`));
      else if (!isNonEmpty(s)) out.push(finding('required_sections', severity, `${p.artifact}:${s.startLine}`, `section "${name}" is empty`));
    }
    return out;
  },
};
