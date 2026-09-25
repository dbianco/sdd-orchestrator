import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type pg from 'pg';
import { hashToken, hasScope } from '../auth/tokens.js';
import type { Logger } from '../logging.js';
import { findActiveTokenByHash, touchToken } from '../store/tokens.js';

export interface AdminIdentity { actor: string; canApprove: boolean; apps: string[] | null }

// timingSafeEqual throws if the two buffers differ in length, so the length check must come
// first — comparing a wrong-length guess still costs the same time as a right-length one.
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function challenge(res: Response): void {
  res.setHeader('WWW-Authenticate', 'Basic realm="sdd-admin"');
  res.status(401).json({ error: 'unauthorized' });
}

// The Basic password is a personal token with approver or admin scope, or the shared SDD_ADMIN_TOKEN,
// which logs in read-only so that every approval names a person.
export function adminAuth(deps: { pool: pg.Pool; logger?: Logger }, legacyToken: string | null) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    const prefix = 'Basic ';
    if (!header || !header.startsWith(prefix)) { challenge(res); return; }
    const decoded = Buffer.from(header.slice(prefix.length), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const password = separator === -1 ? decoded : decoded.slice(separator + 1);
    try {
      if (password.startsWith('sdd_')) {
        const row = await findActiveTokenByHash(deps.pool, hashToken(password));
        if (row && hasScope(row.scopes, 'approver')) {
          touchToken(deps.pool, row.id).catch((e: unknown) => deps.logger?.warn({ err: e }, 'could not record token use'));
          res.locals.admin = { actor: row.actor, canApprove: true, apps: row.app_ids } satisfies AdminIdentity;
          next();
          return;
        }
      }
    } catch (e) {
      deps.logger?.error({ err: e }, 'admin token lookup failed');
      res.status(503).json({ error: 'unavailable' });
      return;
    }
    if (legacyToken && safeEqual(password, legacyToken)) {
      res.locals.admin = { actor: 'admin-token', canApprove: false, apps: null } satisfies AdminIdentity;
      next();
      return;
    }
    challenge(res);
  };
}
