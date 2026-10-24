import { initDatabase, closeDatabase, withTransaction } from '../server/db.ts';
import { runMigrations } from '../db/migrate.ts';
import { runIntegrityChecks } from '../server/services/integrity.ts';

// npm run check:integrity - read-only verification of the stock, budget and receipt invariants.
async function main() {
  await initDatabase();
  await runMigrations();
  const report = await withTransaction((tx) => runIntegrityChecks(tx));
  for (const check of report.checks) {
    console.log(`[${check.ok ? 'ok' : 'FAIL'}] ${check.name}: ${check.detail}`);
  }
  await closeDatabase();
  console.log(report.ok ? '\nAll integrity checks passed.' : '\nIntegrity checks FAILED.');
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  console.error('Integrity check could not run:', err);
  process.exit(1);
});
