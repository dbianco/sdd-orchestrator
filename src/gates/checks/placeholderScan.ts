import { z } from 'zod';
import { lines } from '../markdown.js';
import { finding, type CheckDefinition } from '../types.js';

export const DEFAULT_MARKERS = ['\\bTBD\\b', '\\bTODO\\b', 'NEEDS HUMAN INPUT', '\\bOQ-\\d+\\b'];

const Params = z.object({ markers: z.array(z.string()).optional() });

export const placeholderScan: CheckDefinition = {
  name: 'placeholder_scan',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ artifacts, params, severity }) => {
    const markers = (Params.parse(params).markers ?? DEFAULT_MARKERS).map((m) => ({ source: m, re: new RegExp(m) }));
    const out = [];
    for (const [name, text] of Object.entries(artifacts)) {
      for (const line of lines(text)) {
        for (const m of markers) {
          if (m.re.test(line.text)) out.push(finding('placeholder_scan', severity, `${name}:${line.n}`, `marker ${m.source}`));
        }
      }
    }
    return out;
  },
};
