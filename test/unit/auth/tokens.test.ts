import { describe, it, expect } from 'vitest';
import { generateToken, hashToken, hasScope } from '../../../src/auth/tokens.js';

describe('tokens', () => {
  it('generates distinct sdd_ tokens of 32 random bytes', () => {
    const a = generateToken();
    expect(a).toMatch(/^sdd_[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });
  it('hashes with sha256 hex', () => {
    expect(hashToken('sdd_x')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('sdd_x')).toBe(hashToken('sdd_x'));
  });
  it('lets admin satisfy approver, nothing else', () => {
    expect(hasScope(['admin'], 'approver')).toBe(true);
    expect(hasScope(['admin'], 'host')).toBe(false);
    expect(hasScope(['host', 'ci'], 'ci')).toBe(true);
  });
});
