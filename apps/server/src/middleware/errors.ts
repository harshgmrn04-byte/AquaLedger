import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;
  if (error instanceof SyntaxError || (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large')) {
    res.status(error instanceof SyntaxError ? 400 : 413).json({ error: error instanceof SyntaxError ? 'invalid_json' : 'body_too_large' });
  } else { res.status(500).json({ error: 'internal_error' }); }
};

