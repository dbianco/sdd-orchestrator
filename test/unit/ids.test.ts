import { describe, it, expect } from 'vitest';
import { newId } from '../../src/ids.js';

describe('newId', () => {
  it('prefixes a lowercase ulid', () => {
    const id = newId('f');
    expect(id).toMatch(/^f_[0-9a-hjkmnp-tv-z]{26}$/);
  });

  it('is unique across calls', () => {
    const a = newId('k');
    const b = newId('k');
    expect(a).not.toBe(b);
  });
});
