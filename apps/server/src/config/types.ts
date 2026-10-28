import type pg from 'pg';
import type { JWTVerifyGetKey } from 'jose';

export type IngestConfig = {
  pool: pg.Pool;
  credential: string;
  csvPath: string;
  profilePath: string;
  log?: (entry: Record<string, unknown>) => void;
  billing?: { jwks: JWTVerifyGetKey; issuer: string; audience: string; fixturePath?: string; groqKey?: string; groqTransport?: typeof fetch };
  demoReadOnly?: boolean;
  webOrigin?: string;
};

