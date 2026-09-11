import { describe, it, expect } from 'vitest';
import { countTokens, TOKENIZER } from '../../src/tokens.js';

describe('countTokens', () => {
  it('names the tokenizer', () => {
    expect(TOKENIZER).toBe('cl100k_base');
  });
  it('counts zero for empty text', () => {
    expect(countTokens('')).toBe(0);
  });
  it('counts a short sentence in the expected range', () => {
    const n = countTokens('The quick brown fox jumps over the lazy dog.');
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(12);
  });
});
