import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, withTransaction } from '../server/db.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const MIGRATION_LOCK_KEY = 4242;

// Applies every numbered .sql file in db/migrations that has not run yet, in name order.
// Each file runs in its own transaction and is recorded in schema_migrations.
export async function runMigrations(): Promise<string[]> {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())'
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    const didApply = await withTransaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
      const existing = await tx.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (existing.rows.length > 0) return false;
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      return true;
    });
    if (didApply) applied.push(file);
  }
  return applied;
}
