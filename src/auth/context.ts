import type { Scope } from './tokens.js';

export const AUTH_MODES = ['enforce', 'warn', 'off'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export type AuthContext =
  | { kind: 'token'; token_id: string; actor: string; scopes: Scope[]; app_ids: string[] | null }
  | { kind: 'anonymous'; mode: AuthMode }
  | { kind: 'local' };

export const LOCAL_AUTH: AuthContext = { kind: 'local' };
