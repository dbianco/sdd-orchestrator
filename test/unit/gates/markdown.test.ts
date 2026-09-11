import { describe, it, expect } from 'vitest';
import { lines, parseSections, findSection, isNonEmpty, normalizeHeading } from '../../../src/gates/markdown.js';

const md = `# Title
intro

## Goal
Ship exports.

## Acceptance Criteria

### Sub
- item

## Empty

## Code
\`\`\`md
## not a heading
\`\`\`
`;

describe('lines', () => {
  it('numbers lines from 1 and marks fenced lines', () => {
    const ls = lines(md);
    expect(ls[0]).toEqual({ n: 1, text: '# Title', inFence: false });
    const fenced = ls.find((l) => l.text === '## not a heading');
    expect(fenced?.inFence).toBe(true);
  });
});

describe('parseSections', () => {
  it('finds headings outside fences with levels and line ranges', () => {
    const s = parseSections(md);
    expect(s.map((x) => [x.heading, x.level])).toEqual([
      ['Title', 1], ['Goal', 2], ['Acceptance Criteria', 2], ['Sub', 3], ['Empty', 2], ['Code', 2],
    ]);
    expect(findSection(s, 'goal')?.startLine).toBe(4);
  });
  it('treats a section as non-empty only with body text before the next same-or-higher heading', () => {
    const s = parseSections(md);
    expect(isNonEmpty(findSection(s, 'Goal')!)).toBe(true);
    expect(isNonEmpty(findSection(s, 'Acceptance Criteria')!)).toBe(true); // "- item" under ### Sub counts
    expect(isNonEmpty(findSection(s, 'Empty')!)).toBe(false);
    expect(isNonEmpty(findSection(s, 'Code')!)).toBe(true);
  });
  it('normalizes numbering and trailing hashes', () => {
    expect(normalizeHeading('## 1. Goal ##')).toBe('goal');
    expect(normalizeHeading('ADDED Requirements')).toBe('added requirements');
  });
});
