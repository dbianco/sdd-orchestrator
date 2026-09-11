import { describe, it, expect } from 'vitest';
import { extractExactIds } from '../../../src/assembler/exactIds.js';
import { mergeAndRank, type RetrievedChunk } from '../../../src/store/retrieval.js';

describe('extractExactIds', () => {
  it('finds ADR/REQ/US/INC ids across inputs, unique, in order', () => {
    expect(extractExactIds('see ADR-7 and REQ-12, again ADR-7', null, 'INC-204', 'US-2')).toEqual(['ADR-7', 'REQ-12', 'INC-204', 'US-2']);
  });
  it('ignores near misses', () => {
    expect(extractExactIds('ADR7 CVE-2026-1 xREQ-1')).toEqual([]);
  });
});

function chunk(over: Partial<RetrievedChunk>): RetrievedChunk {
  return { chunk_id: 'c', item_id: 'i', stable_id: 's', version: 1, app_id: null, kind: 'standard', memory_type: null, heading_path: 'h', text: 't', token_count: 1, score: 0.5, match: 'vector', ...over };
}

describe('mergeAndRank', () => {
  it('puts exact hits first, dedupes by item keeping the best, and limits', () => {
    const exact = [chunk({ chunk_id: 'e1', item_id: 'A', score: 1, match: 'exact_id' })];
    const vector = [
      chunk({ chunk_id: 'v1', item_id: 'A', score: 0.9 }),
      chunk({ chunk_id: 'v2', item_id: 'B', score: 0.7 }),
      chunk({ chunk_id: 'v3', item_id: 'B', score: 0.8 }),
      chunk({ chunk_id: 'v4', item_id: 'C', score: 0.6 }),
    ];
    const out = mergeAndRank(exact, vector, 2);
    expect(out.map((c) => c.chunk_id)).toEqual(['e1', 'v3']);
  });
});
