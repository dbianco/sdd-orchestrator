import { createHash, randomBytes } from 'node:crypto';

export const SCOPES = ['host', 'ci', 'approver', 'admin'] as const;
export type Scope = (typeof SCOPES)[number];

export function generateToken(): string {
  return `sdd_${randomBytes(32).toString('base64url')}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hasScope(scopes: readonly Scope[], needed: Scope): boolean {
  return scopes.includes(needed) || (needed === 'approver' && scopes.includes('admin'));
}
