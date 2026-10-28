import pino from 'pino';

export function createHttpLogger() {
  const logger = pino({ redact: { paths: ['authorization', 'password', 'credential', 'req.headers.authorization'], remove: true } });
  return (entry: Record<string, unknown>) => logger.info(entry, 'http_request');
}

