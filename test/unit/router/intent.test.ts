import { describe, it, expect } from 'vitest';
import { inferIntent, DEFAULT_PHRASE_LISTS } from '../../../src/router/intent.js';

describe('inferIntent', () => {
  it('defaults to feature', () => {
    expect(inferIntent('Add CSV export to the orders page')).toEqual({ intent: 'feature', matched: null });
  });
  it('detects incident phrases including INC ids', () => {
    expect(inferIntent('Checkout is broken, see INC-204').intent).toBe('incident');
    expect(inferIntent('production is down for EU').intent).toBe('incident');
    expect(inferIntent('P1: payments failing').intent).toBe('incident');
  });
  it('detects remediation', () => {
    expect(inferIntent('Fix CVE-2026-1234 in lodash').intent).toBe('remediation');
    expect(inferIntent('Snyk flagged a vulnerability').intent).toBe('remediation');
  });
  it('detects refactor, spike and product', () => {
    expect(inferIntent('Refactor the export module, no behaviour change').intent).toBe('refactor');
    expect(inferIntent('Can we stream exports? prototype it').intent).toBe('spike');
    expect(inferIntent('Write the PRD for a new product').intent).toBe('product');
  });
  it('applies precedence incident > remediation > refactor > spike > product', () => {
    expect(inferIntent('hotfix: refactor after CVE-1 prototype for new product').intent).toBe('incident');
    expect(inferIntent('refactor after CVE-1, can we prototype').intent).toBe('remediation');
    expect(inferIntent('untangle this, can we prototype the PRD').intent).toBe('refactor');
  });
  it('never infers trivial', () => {
    expect(inferIntent('trivial: bump a version').intent).toBe('feature');
  });
  it('reports the matched phrase', () => {
    expect(inferIntent('is it possible to cache this?').matched).toBe('is it possible');
  });
  it('accepts custom phrase lists', () => {
    const lists = { ...DEFAULT_PHRASE_LISTS, spike: ['explore'] };
    expect(inferIntent('explore caching', lists).intent).toBe('spike');
    expect(inferIntent('can we cache', lists).intent).toBe('feature');
  });
});
