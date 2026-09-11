import { describe, it, expect } from 'vitest';
import { slugify, defaultFeatureSlug } from '../../../src/lifecycle/slug.js';

describe('slugify', () => {
  it('lowercases, strips punctuation, collapses dashes and truncates', () => {
    expect(slugify('Add CSV export to the orders page!')).toBe('add-csv-export-to-the-orders-page');
    expect(slugify('  Ünïcode -- and   spaces ')).toBe('unicode-and-spaces');
    expect(slugify('a'.repeat(100))).toHaveLength(48);
  });
});

describe('defaultFeatureSlug', () => {
  it('prefixes the external ref', () => {
    expect(defaultFeatureSlug('Add CSV export', 'YAL-123')).toBe('yal-123-add-csv-export');
    expect(defaultFeatureSlug('Add CSV export', null)).toBe('add-csv-export');
  });
});
