import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type pg from 'pg';
import type { AuthContext, AuthMode } from '../auth/context.js';
import { hashToken } from '../auth/tokens.js';
import type { Logger } from '../logging.js';
import type { MetricsHooks } from '../services/deps.js';
import { findActiveTokenByHash, touchToken } from '../store/tokens.js';

interface Deps { pool: pg.Pool; logger?: Logger; metrics?: MetricsHooks }

function reject(res: Response): void {
  res.setHeader('WWW-Authenticate', 'Bearer realm="sdd"');
  res.status(401).json({ error: 'unauthorized' });
}

export async function resolveBearer(deps: Deps, header: string | undefined): Promise<AuthContext | 'invalid' | null> {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) return 'invalid';
  const row = await findActiveTokenByHash(deps.pool, hashToken(m[1]!));
  if (!row) return 'invalid';
  touchToken(deps.pool, row.id).catch((e: unknown) => deps.logger?.warn({ err: e }, 'could not record token use'));
  return { kind: 'token', token_id: row.id, actor: row.actor, scopes: row.scopes, app_ids: row.app_ids };
}

export function mcpAuth(deps: Deps, mode: AuthMode): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (mode === 'off') { res.locals.auth = { kind: 'anonymous', mode } satisfies AuthContext; next(); return; }
    try {
      const resolved = await resolveBearer(deps, req.headers.authorization);
      if (resolved === 'invalid') { deps.metrics?.authRejected('invalid'); reject(res); return; }
      if (resolved === null) {
        if (mode === 'enforce') { deps.metrics?.authRejected('missing'); reject(res); return; }
        deps.metrics?.authRejected('would_reject');
        res.locals.auth = { kind: 'anonymous', mode } satisfies AuthContext;
      } else {
        res.locals.auth = resolved;
      }
      next();
    } catch (e) {
      deps.logger?.error({ err: e }, 'token lookup failed');
      res.status(503).json({ error: 'unavailable' });
    }
  };
}
