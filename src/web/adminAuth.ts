import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

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

export function adminAuth(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    const prefix = 'Basic ';
    if (!header || !header.startsWith(prefix)) { challenge(res); return; }
    const decoded = Buffer.from(header.slice(prefix.length), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const password = separator === -1 ? decoded : decoded.slice(separator + 1);
    if (!safeEqual(password, token)) { challenge(res); return; }
    next();
  };
}
