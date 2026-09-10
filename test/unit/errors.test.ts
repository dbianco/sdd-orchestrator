import { describe, it, expect } from 'vitest';
import { DomainError, ERROR_PRECEDENCE, firstByPrecedence } from '../../src/errors.js';

describe('DomainError', () => {
  it('carries code, message and details', () => {
    const e = new DomainError('APP_NOT_FOUND', 'no app "x"', { app: 'x' });
    expect(e.code).toBe('APP_NOT_FOUND');
    expect(e.message).toBe('no app "x"');
    expect(e.details).toEqual({ app: 'x' });
    expect(e.toJSON()).toEqual({ code: 'APP_NOT_FOUND', message: 'no app "x"', details: { app: 'x' } });
  });

  it('orders codes as in spec 7.5', () => {
    expect(ERROR_PRECEDENCE).toEqual([
      'VALIDATION_ERROR', 'APP_NOT_FOUND', 'FEATURE_NOT_FOUND', 'UNKNOWN_FRAMEWORK',
      'FEATURE_ARCHIVED', 'STALE_STATE', 'FEATURE_BLOCKED', 'PHASE_ORDER_VIOLATION',
      'EMBEDDING_MODEL_MISMATCH',
    ]);
  });

  it('picks the first applicable error', () => {
    const stale = new DomainError('STALE_STATE', 'stale');
    const archived = new DomainError('FEATURE_ARCHIVED', 'archived');
    expect(firstByPrecedence([stale, archived])).toBe(archived);
  });
});
