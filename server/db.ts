import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { env, DATA_DIR } from './env.ts';

export type Row = Record<string, any>;

export interface QueryResult<T = Row> {
  rows: T[];
  rowCount: number;
}

// A query target. Inside withTransaction() the callback receives a transaction-bound Db;
// always use that argument inside a transaction. The global `db` would wait on (PGlite)
// or bypass (pg) the open transaction.
export interface Db {
  query<T = Row>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(text: string): Promise<void>;
}

type Mode = 'postgres' | 'pglite';

let mode: Mode = 'pglite';
let pool: pg.Pool | null = null;
let lite: PGlite | null = null;

function sanitize(params: unknown[] = []): unknown[] {
  return params.map((value) => (value === undefined ? null : value));
}

function shape(res: { rows: any[]; rowCount?: number | null; affectedRows?: number }): QueryResult {
  return {
    rows: res.rows,
    rowCount: res.rowCount ?? res.affectedRows ?? res.rows.length,
  };
}

function wrapPglite(target: { query: PGlite['query']; exec: PGlite['exec'] }): Db {
  return {
    query: async <T = Row>(text: string, params: unknown[] = []) =>
      shape((await target.query(text, sanitize(params))) as any) as QueryResult<T>,
    exec: async (text: string) => {
      await target.exec(text);
    },
  };
}

function wrapPg(target: pg.Pool | pg.PoolClient): Db {
  return {
    query: async <T = Row>(text: string, params: unknown[] = []) =>
      shape(await target.query(text, sanitize(params))) as QueryResult<T>,
    exec: async (text: string) => {
      // No parameters means the simple protocol, which accepts multi-statement scripts.
      await target.query(text);
    },
  };
}

export async function initDatabase(): Promise<{ mode: Mode }> {
  if (env.databaseUrl) {
    const candidate = new pg.Pool({
      connectionString: env.databaseUrl,
      // Certificates are verified by default. Only DATABASE_SSL_INSECURE=true (self-signed servers) turns that off.
      ssl: env.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== 'true' },
      max: 10,
      connectionTimeoutMillis: 10000,
    });
    candidate.on('error', (err) => console.error('[StockSense DB] Pool error:', err.message));
    try {
      const client = await candidate.connect();
      client.release();
      pool = candidate;
      mode = 'postgres';
      console.log('[StockSense DB] Connected to PostgreSQL.');
      return { mode };
    } catch (err: any) {
      // On Vercel there is no writable disk for the embedded database, so a failed connection must surface.
      if (process.env.VERCEL) throw new Error(`Cannot connect to DATABASE_URL: ${err.message}`);
      console.warn(`[StockSense DB] DATABASE_URL is set but unreachable (${err.message}). Using the embedded database.`);
      await candidate.end().catch(() => {});
    }
  }

  if (process.env.VERCEL) throw new Error('DATABASE_URL must be set on Vercel. The embedded database cannot run there.');
  const liteDir = path.join(DATA_DIR, 'pglite');
  fs.mkdirSync(liteDir, { recursive: true });
  lite = new PGlite(liteDir);
  await lite.waitReady;
  mode = 'pglite';
  console.log(`[StockSense DB] Using embedded PostgreSQL (PGlite) at ${path.join(DATA_DIR, 'pglite')}.`);
  return { mode };
}

export function databaseMode(): Mode {
  return mode;
}

export const db: Db = {
  query: async <T = Row>(text: string, params: unknown[] = []) => {
    if (mode === 'postgres' && pool) return shape(await pool.query(text, sanitize(params))) as QueryResult<T>;
    if (!lite) throw new Error('Database not initialised. Call initDatabase() first.');
    return shape((await lite.query(text, sanitize(params))) as any) as QueryResult<T>;
  },
  exec: async (text: string) => {
    if (mode === 'postgres' && pool) {
      await pool.query(text);
      return;
    }
    if (!lite) throw new Error('Database not initialised. Call initDatabase() first.');
    await lite.exec(text);
  },
};

export async function withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  if (mode === 'postgres' && pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(wrapPg(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  if (!lite) throw new Error('Database not initialised. Call initDatabase() first.');
  return lite.transaction((tx) => fn(wrapPglite(tx as any)));
}

export async function closeDatabase(): Promise<void> {
  if (pool) await pool.end();
  if (lite) await lite.close();
  pool = null;
  lite = null;
}
