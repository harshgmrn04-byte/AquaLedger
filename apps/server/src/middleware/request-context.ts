import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export function requestContext(log: (entry: Record<string, unknown>) => void): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    const start = process.hrtime.bigint();
    res.setHeader('X-Request-Id', requestId);
    res.locals.requestId = requestId;
    res.on('finish', () => {
      const route = req.route ? `${req.baseUrl}${req.route.path === '/' ? '' : req.route.path}` : req.path;
      log({ requestId, route, status: res.statusCode, durationMs: Number(process.hrtime.bigint() - start) / 1e6, batchId: res.locals.batchId ?? null, revisionId: res.locals.revisionId ?? null, counts: res.locals.counts ?? null, failureCategory: res.locals.failureCategory ?? null });
    });
    next();
  };
}

