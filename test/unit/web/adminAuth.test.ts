import { describe, it, expect, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type pg from 'pg';
import { hashToken } from '../../../src/auth/tokens.js';
import { adminAuth } from '../../../src/web/adminAuth.js';

function basicHeader(password: string, user = 'admin'): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

function mockRes() {
  const res = {
    statusCode: 0, headers: {} as Record<string, string>, body: undefined as unknown, locals: {} as Record<string, unknown>,
    setHeader(name: string, value: string) { res.headers[name] = value; },
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
  };
  return res as unknown as Response & { statusCode: number; headers: Record<string, string>; body: unknown; locals: Record<string, unknown> };
}

const tokens: Record<string, { id: string; actor: string; scopes: string[]; app_ids: string[] | null }> = {
  [hashToken('sdd_approver')]: { id: 'tk_a', actor: 'dana', scopes: ['host', 'approver'], app_ids: ['app_c'] },
  [hashToken('sdd_hostonly')]: { id: 'tk_h', actor: 'bob', scopes: ['host'], app_ids: null },
};
const pool = { query: vi.fn(async (sql: string, params: unknown[]) => ({ rows: sql.includes('SELECT') && tokens[params[0] as string] ? [tokens[params[0] as string]] : [] })) } as unknown as pg.Pool;

async function call(password: string | null, legacy: string | null = 's3cret') {
  const req = { headers: password === null ? {} : { authorization: basicHeader(password) } } as Request;
  const res = mockRes();
  const next = vi.fn();
  await adminAuth({ pool }, legacy)(req, res, next as NextFunction);
  return { res, next };
}

describe('adminAuth', () => {
  it('rejects a missing Authorization header with 401 and a WWW-Authenticate challenge', async () => {
    const { res, next } = await call(null);
    expect(res.statusCode).toBe(401);
    expect(res.headers['WWW-Authenticate']).toBe('Basic realm="sdd-admin"');
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects the wrong password, a host-only token, and the legacy token when it is unset', async () => {
    expect((await call('wrong')).res.statusCode).toBe(401);
    expect((await call('sdd_hostonly')).res.statusCode).toBe(401);
    expect((await call('s3cret', null)).res.statusCode).toBe(401);
  });

  it('logs in a personal approver token with approval rights and its app restriction', async () => {
    const { res, next } = await call('sdd_approver');
    expect(next).toHaveBeenCalledOnce();
    expect(res.locals.admin).toEqual({ actor: 'dana', canApprove: true, apps: ['app_c'] });
  });

  it('logs in the shared SDD_ADMIN_TOKEN read-only, whatever the username', async () => {
    const { res, next } = await call('s3cret');
    expect(next).toHaveBeenCalledOnce();
    expect(res.locals.admin).toEqual({ actor: 'admin-token', canApprove: false, apps: null });
  });
});
