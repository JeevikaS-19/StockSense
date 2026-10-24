import { initDatabase, closeDatabase, databaseMode } from '../server/db.ts';
import { runMigrations } from '../db/migrate.ts';

// npm run db:setup - applies every pending migration in db/migrations, then exits.
async function main() {
  const { mode } = await initDatabase();
  console.log(`Database: ${mode === 'postgres' ? 'PostgreSQL (DATABASE_URL)' : 'embedded PostgreSQL (PGlite, .data/pglite)'}`);
  const applied = await runMigrations();
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Schema is already up to date.');
  console.log(`Active mode: ${databaseMode()}`);
  await closeDatabase();
}

main().catch((err) => {
  console.error('Database setup failed:', err);
  process.exit(1);
});
