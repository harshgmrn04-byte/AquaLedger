import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

function tokenMatches(header: string | undefined, credential: string): boolean {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const a = createHash('sha256').update(token).digest();
  const b = createHash('sha256').update(credential).digest();
  return token.length > 0 && timingSafeEqual(a, b);
}

export function requireIngestionCredential(credential: string): RequestHandler {
  return (req, res, next) => {
    if (!tokenMatches(req.headers.authorization, credential)) { res.status(401).json({ error: 'unauthorized' }); return; }
    next();
  };
}

