import { initDatabase, closeDatabase } from '../server/db.ts';
import { runMigrations } from '../db/migrate.ts';
import { seedDemoData } from '../server/services/demo.ts';

// npm run seed:demo - replaces all data with the demo dataset and prints a reconciliation summary.
async function main() {
  await initDatabase();
  await runMigrations();
  const summary = await seedDemoData();

  console.log('\nDemo data loaded.');
  for (const lab of summary.labs) {
    const b = lab.budget;
    console.log(
      `${lab.code} ${lab.name}: allocated ${b.allocated}, committed ${b.committed}, spent ${b.spent}, available ${b.available} (${b.percent_used}% used), open POs ${lab.open_pos}`
    );
  }
  console.log(`Purchase orders: ${summary.purchase_orders}, receipts: ${summary.receipts}, stock transactions: ${summary.transactions}`);
  console.log('\nIntegrity checks:');
  for (const check of summary.integrity.checks) {
    console.log(`  [${check.ok ? 'ok' : 'FAIL'}] ${check.name}: ${check.detail}`);
  }
  console.log('\nSign in with:');
  for (const cred of summary.credentials) {
    console.log(`  ${cred.role}: ${cred.email} / ${cred.password}`);
  }
  await closeDatabase();
  if (!summary.integrity.ok) process.exit(1);
}

main().catch((err) => {
  console.error('Demo seed failed:', err);
  process.exit(1);
});
