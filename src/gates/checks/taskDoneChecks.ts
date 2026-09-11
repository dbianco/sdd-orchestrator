import { z } from 'zod';
import { lines, type Line } from '../markdown.js';
import { finding, type CheckDefinition } from '../types.js';

export interface TaskBlock { startLine: number; lines: Line[]; match: RegExpExecArray }

export function taskBlocks(text: string, taskRegex: RegExp): TaskBlock[] {
  const blocks: TaskBlock[] = [];
  let current: TaskBlock | null = null;
  for (const line of lines(text)) {
    const m = line.inFence ? null : taskRegex.exec(line.text);
    if (m) {
      current = { startLine: line.n, lines: [line], match: m };
      blocks.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return blocks;
}

const Params = z.object({ artifact: z.string(), task_regex: z.string(), done_regex: z.string() });

export const taskDoneChecks: CheckDefinition = {
  name: 'task_done_checks',
  defaultSeverity: 'blocker',
  params: Params,
  run: ({ artifacts, params, severity }) => {
    const p = Params.parse(params);
    const text = artifacts[p.artifact];
    if (text === undefined) return [];
    const done = new RegExp(p.done_regex);
    const out = [];
    for (const block of taskBlocks(text, new RegExp(p.task_regex))) {
      if (!block.lines.some((l) => done.test(l.text))) {
        const title = block.lines[0]!.text.replace(new RegExp(p.task_regex), '').replace(done, '').trim();
        out.push(finding('task_done_checks', severity, `${p.artifact}:${block.startLine}`, `task "${title}" has no done check matching ${p.done_regex}`));
      }
    }
    return out;
  },
};
