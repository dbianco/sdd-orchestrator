import { describe, it, expect, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { adminAuth } from '../../../src/web/adminAuth.js';

function basicHeader(password: string, user = 'admin'): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

function mockRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(name: string, value: string) { res.headers[name] = value; },
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
  };
  return res as unknown as Response & { statusCode: number; headers: Record<string, string>; body: unknown };
}

describe('adminAuth', () => {
  const middleware = adminAuth('s3cret');

  it('rejects a missing Authorization header with 401 and a WWW-Authenticate challenge', () => {
    const req = { headers: {} } as Request;
    const res = mockRes();
    const next = vi.fn();
    middleware(req, res, next as NextFunction);
    expect(res.statusCode).toBe(401);
    expect(res.headers['WWW-Authenticate']).toBe('Basic realm="sdd-admin"');
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects the wrong password with 401', () => {
    const req = { headers: { authorization: basicHeader('wrong') } } as Request;
    const res = mockRes();
    const next = vi.fn();
    middleware(req, res, next as NextFunction);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() with the correct password, regardless of username', () => {
    const req = { headers: { authorization: basicHeader('s3cret', 'whoever') } } as Request;
    const res = mockRes();
    const next = vi.fn();
    middleware(req, res, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });
});
