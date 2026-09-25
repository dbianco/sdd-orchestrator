import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import type pg from 'pg';
import { hashToken } from '../../../src/auth/tokens.js';
import { mcpAuth } from '../../../src/web/mcpAuth.js';
import type { AuthMode } from '../../../src/auth/context.js';

const GOOD = 'sdd_good';
const row = { id: 'tk_1', actor: 'dana', scopes: ['host'], app_ids: null };

function pool(): pg.Pool {
  return { query: vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('SELECT')) return { rows: params[0] === hashToken(GOOD) ? [row] : [] };
    return { rows: [] };
  }) } as unknown as pg.Pool;
}

async function call(mode: AuthMode, authorization?: string) {
  const metrics = { authRejected: vi.fn() } as never;
  const res = { locals: {} as Record<string, unknown>, statusCode: 200, headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k] = v; }, status(c: number) { this.statusCode = c; return this; }, json() { return this; } };
  const next = vi.fn();
  await mcpAuth({ pool: pool(), metrics }, mode)({ headers: authorization ? { authorization } : {} } as Request, res as unknown as Response, next);
  return { res, next, metrics: metrics as unknown as { authRejected: ReturnType<typeof vi.fn> } };
}

describe('mcpAuth', () => {
  it('accepts a valid bearer token in every mode except off, and exposes its identity', async () => {
    for (const mode of ['enforce', 'warn'] as const) {
      const { res, next } = await call(mode, `Bearer ${GOOD}`);
      expect(next).toHaveBeenCalledOnce();
      expect(res.locals.auth).toEqual({ kind: 'token', token_id: 'tk_1', actor: 'dana', scopes: ['host'], app_ids: null });
    }
  });
  it('rejects a missing token only in enforce', async () => {
    const enforce = await call('enforce');
    expect(enforce.res.statusCode).toBe(401);
    expect(enforce.res.headers['WWW-Authenticate']).toBe('Bearer realm="sdd"');
    expect(enforce.metrics.authRejected).toHaveBeenCalledWith('missing');
    const warn = await call('warn');
    expect(warn.next).toHaveBeenCalledOnce();
    expect(warn.res.locals.auth).toEqual({ kind: 'anonymous', mode: 'warn' });
    expect(warn.metrics.authRejected).toHaveBeenCalledWith('would_reject');
  });
  it('rejects an invalid or malformed token in enforce and warn', async () => {
    for (const mode of ['enforce', 'warn'] as const) {
      for (const header of ['Bearer sdd_wrong', 'Basic abc']) {
        const { res, next, metrics } = await call(mode, header);
        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
        expect(metrics.authRejected).toHaveBeenCalledWith('invalid');
      }
    }
  });
  it('ignores the header entirely in off', async () => {
    const { res, next } = await call('off', 'Bearer sdd_wrong');
    expect(next).toHaveBeenCalledOnce();
    expect(res.locals.auth).toEqual({ kind: 'anonymous', mode: 'off' });
  });
});
