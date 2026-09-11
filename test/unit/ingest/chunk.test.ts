import { describe, it, expect } from 'vitest';
import { chunkMarkdown, embedText, CHUNK_TOKEN_CAP } from '../../../src/ingest/chunk.js';
import { countTokens } from '../../../src/tokens.js';

const para = (n: number) => Array.from({ length: n }, (_, i) => `Sentence number ${i} about exports and orders.`).join(' ');

describe('chunkMarkdown', () => {
  it('splits on H2 with heading paths and ordinals', () => {
    const c = chunkMarkdown('intro text\n\n## Goal\ngoal text\n\n## Rationale\nwhy');
    expect(c.map((x) => [x.ordinal, x.heading_path])).toEqual([[0, ''], [1, 'Goal'], [2, 'Rationale']]);
    expect(c[1]?.text).toBe('goal text');
    expect(c[1]?.token_count).toBe(countTokens('goal text'));
  });
  it('splits an oversized H2 on H3, then on paragraphs, never over the cap', () => {
    const md = `## Big\n\n### A\n\n${para(40)}\n\n${para(40)}\n\n### B\n\n${para(20)}`;
    const c = chunkMarkdown(md);
    expect(c.length).toBeGreaterThan(2);
    for (const x of c) expect(x.token_count).toBeLessThanOrEqual(CHUNK_TOKEN_CAP);
    expect(c.every((x) => x.heading_path.startsWith('Big > '))).toBe(true);
  });
  it('never splits inside a fence or a table', () => {
    const fence = '```ts\n' + Array.from({ length: 300 }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n```';
    const table = Array.from({ length: 120 }, (_, i) => `| r${i} | value ${i} |`).join('\n');
    const c = chunkMarkdown(`## Code\n\n${fence}\n\n## Table\n\n| a | b |\n|---|---|\n${table}`);
    const code = c.filter((x) => x.heading_path === 'Code');
    expect(code).toHaveLength(1);
    expect(code[0]?.text.split('```').length).toBe(3);
    const tbl = c.filter((x) => x.heading_path === 'Table');
    expect(tbl).toHaveLength(1);
  });
  it('builds the embedded text with the title and path', () => {
    const [c] = chunkMarkdown('## Rationale\nwhy');
    expect(embedText('ADR-7 Streaming', c!)).toBe('ADR-7 Streaming > Rationale\n\nwhy');
    const [p] = chunkMarkdown('preamble');
    expect(embedText('Doc', p!)).toBe('Doc\n\npreamble');
  });
  it('returns nothing for an empty body', () => {
    expect(chunkMarkdown('   \n')).toEqual([]);
  });
});
