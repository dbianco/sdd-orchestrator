import { describe, it, expect } from 'vitest';
import { identityKey } from '../../../src/store/routingEvents.js';

describe('identityKey', () => {
  it('uses the ticket, trimmed and upper-cased, when present', () => {
    expect(identityKey(' yal-123 ', 'anything')).toBe('ticket:YAL-123');
    expect(identityKey('YAL-123', 'other text')).toBe('ticket:YAL-123');
  });
  it('falls back to a hash of the normalized task text', () => {
    const a = identityKey(null, 'Fix the  Date   picker');
    const b = identityKey('', 'fix the date picker ');
    expect(a).toMatch(/^text:[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(identityKey(null, 'fix the date range')).not.toBe(a);
  });
});
