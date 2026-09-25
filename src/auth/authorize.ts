import type { Queryable } from '../db/pool.js';
import { DomainError } from '../errors.js';
import type { AuthContext } from './context.js';
import { hasScope, type Scope } from './tokens.js';

export const UNAUTHENTICATED_WARNING = 'unauthenticated call accepted because SDD_AUTH_MODE=warn';

export interface CallTarget {
  scope?: Scope;
  apps?: string[];
  company?: boolean;
  featureId?: string;
  appIds?: string[];
}
export interface AuthorizedCall { actor: string | null; token_id: string | null; warnings: string[] }

const forbidden = (message: string, details: Record<string, unknown> = {}) => new DomainError('FORBIDDEN', message, details);

export function callWarnings(auth: AuthContext): string[] {
  return auth.kind === 'anonymous' && auth.mode === 'warn' ? [UNAUTHENTICATED_WARNING] : [];
}

export function resolveActor(auth: AuthContext, payloadActor: string | undefined, warnings: string[], required: boolean): string | null {
  if (auth.kind === 'token') {
    if (payloadActor && payloadActor !== auth.actor) warnings.push(`actor "${payloadActor}" ignored; the token belongs to "${auth.actor}"`);
    return auth.actor;
  }
  const actor = payloadActor ?? (auth.kind === 'local' ? process.env.SDD_ACTOR : undefined) ?? null;
  if (!actor && required) throw new DomainError('VALIDATION_ERROR', 'actor is required when the call carries no token', { field: 'actor' });
  return actor;
}

function assertAllowedIds(auth: Extract<AuthContext, { kind: 'token' }>, ids: string[], label: (id: string) => string): void {
  if (auth.app_ids === null) return;
  for (const id of ids) if (!auth.app_ids.includes(id)) throw forbidden(`this token is not allowed for app ${label(id)}`, { app: label(id) });
}

// Unrestricted tokens and unauthenticated calls pass; unknown apps and features are left to the service,
// except that a restricted token gets FORBIDDEN for an app slug it cannot see.
export async function authorizeCall(q: Queryable, auth: AuthContext, target: CallTarget, payloadActor: string | undefined, actorRequired: boolean): Promise<AuthorizedCall> {
  const warnings = callWarnings(auth);
  if (auth.kind === 'token') {
    const scope = target.scope ?? 'host';
    if (!hasScope(auth.scopes, scope)) throw forbidden(`this token lacks the ${scope} scope`, { scope });
    if (auth.app_ids !== null) {
      if (target.company) throw forbidden('scope "company" needs a token that is not restricted to apps');
      if (target.apps && target.apps.length > 0) {
        const r = await q.query<{ slug: string; id: string }>('SELECT slug, id FROM apps WHERE slug = ANY($1)', [target.apps]);
        const ids = new Map(r.rows.map((x) => [x.slug, x.id]));
        for (const slug of target.apps) {
          const id = ids.get(slug);
          if (!id || !auth.app_ids.includes(id)) throw forbidden(`this token is not allowed for app ${slug}`, { app: slug });
        }
      }
      if (target.featureId) {
        const r = await q.query<{ app_id: string; slug: string }>('SELECT f.app_id, a.slug FROM features f JOIN apps a ON a.id = f.app_id WHERE f.id = $1', [target.featureId]);
        if (r.rows[0]) assertAllowedIds(auth, [r.rows[0].app_id], () => r.rows[0]!.slug);
      }
      if (target.appIds) assertAllowedIds(auth, target.appIds, (id) => id);
    }
  }
  const actor = resolveActor(auth, payloadActor, warnings, actorRequired);
  return { actor, token_id: auth.kind === 'token' ? auth.token_id : null, warnings };
}

export function scopeTarget(scope: 'app' | 'company' | string[] | undefined, referentApp?: string): Pick<CallTarget, 'apps' | 'company'> {
  if (scope === 'company') return { company: true };
  const apps = Array.isArray(scope) ? scope : [];
  return { apps: referentApp ? [referentApp, ...apps] : apps };
}
