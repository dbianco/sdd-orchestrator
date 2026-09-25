import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Queryable } from '../../../src/db/pool.js';
import { authorizeCall, resolveActor, scopeTarget, UNAUTHENTICATED_WARNING } from '../../../src/auth/authorize.js';
import type { AuthContext } from '../../../src/auth/context.js';

const q = { query: vi.fn(async (sql: string) => {
  if (sql.includes('FROM apps')) return { rows: [{ slug: 'checkout', id: 'app_c' }, { slug: 'billing', id: 'app_b' }] };
  if (sql.includes('FROM features')) return { rows: [{ app_id: 'app_b', slug: 'billing' }] };
  return { rows: [] };
}) } as unknown as Queryable;

const token = (over: Partial<Extract<AuthContext, { kind: 'token' }>> = {}): AuthContext => ({ kind: 'token', token_id: 'tk_1', actor: 'dana', scopes: ['host'], app_ids: null, ...over });

describe('resolveActor', () => {
  afterEach(() => { delete process.env.SDD_ACTOR; });
  it('takes the token actor and warns when the payload disagrees', () => {
    const w: string[] = [];
    expect(resolveActor(token(), 'mallory', w, true)).toBe('dana');
    expect(w).toEqual(['actor "mallory" ignored; the token belongs to "dana"']);
  });
  it('uses the payload without a token, SDD_ACTOR locally, and fails when required and absent', () => {
    expect(resolveActor({ kind: 'anonymous', mode: 'warn' }, 'x', [], true)).toBe('x');
    process.env.SDD_ACTOR = 'local-user';
    expect(resolveActor({ kind: 'local' }, undefined, [], true)).toBe('local-user');
    expect(() => resolveActor({ kind: 'anonymous', mode: 'off' }, undefined, [], true)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(resolveActor({ kind: 'anonymous', mode: 'off' }, undefined, [], false)).toBeNull();
  });
});

describe('authorizeCall', () => {
  it('warns on anonymous calls in warn mode only', async () => {
    expect((await authorizeCall(q, { kind: 'anonymous', mode: 'warn' }, {}, 'x', true)).warnings).toEqual([UNAUTHENTICATED_WARNING]);
    expect((await authorizeCall(q, { kind: 'anonymous', mode: 'off' }, {}, 'x', true)).warnings).toEqual([]);
  });
  it('requires the scope; admin satisfies approver', async () => {
    await expect(authorizeCall(q, token({ scopes: ['ci'] }), {}, undefined, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(authorizeCall(q, token({ scopes: ['admin'] }), { scope: 'approver' }, undefined, true)).resolves.toMatchObject({ actor: 'dana', token_id: 'tk_1' });
  });
  it('enforces app restriction by slug, feature and scope', async () => {
    const restricted = token({ app_ids: ['app_c'] });
    await expect(authorizeCall(q, restricted, { apps: ['checkout'] }, undefined, true)).resolves.toMatchObject({ actor: 'dana' });
    await expect(authorizeCall(q, restricted, { apps: ['checkout', 'billing'] }, undefined, true)).rejects.toMatchObject({ code: 'FORBIDDEN', message: expect.stringContaining('billing') });
    await expect(authorizeCall(q, restricted, { apps: ['unknown'] }, undefined, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(authorizeCall(q, restricted, { featureId: 'f_1' }, undefined, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(authorizeCall(q, restricted, { company: true }, undefined, true)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(authorizeCall(q, token(), { company: true, apps: ['billing'] }, undefined, true)).resolves.toMatchObject({ actor: 'dana' });
  });
});

describe('scopeTarget', () => {
  it('maps search/context scopes to the apps they touch', () => {
    expect(scopeTarget(undefined, 'checkout')).toEqual({ apps: ['checkout'] });
    expect(scopeTarget(['billing'], 'checkout')).toEqual({ apps: ['checkout', 'billing'] });
    expect(scopeTarget('company', 'checkout')).toEqual({ company: true });
  });
});
