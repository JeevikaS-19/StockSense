import type { Db, Row } from '../db.ts';
import { fail, round2, toNumber } from '../errors.ts';
import { writeAudit } from './audit.ts';
import { labRecipientIds, notifyUsers } from './notifications.ts';

export const BUDGET_THRESHOLDS = [75, 90, 100];

export interface BudgetSummary {
  budget_id: number | null;
  period_label: string | null;
  start_date: string | null;
  end_date: string | null;
  allocated: number;
  committed: number;
  spent: number;
  available: number;
  percent_used: number;
  burn_rate_per_day: number;
  projected_exhaustion_date: string | null;
}

export async function activeBudget(db: Db, labId: number): Promise<Row | null> {
  const res = await db.query(
    `SELECT id, lab_id, period_label, allocated, is_active,
            start_date::text AS start_date, end_date::text AS end_date
     FROM lab_budgets WHERE lab_id = $1 AND is_active = true`,
    [labId]
  );
  return res.rows[0] ?? null;
}

// The active budget, or the most recent one if none is active (used so late ledger entries still land).
export async function latestBudget(db: Db, labId: number): Promise<Row | null> {
  const active = await activeBudget(db, labId);
  if (active) return active;
  const res = await db.query(
    `SELECT id, lab_id, period_label, allocated, is_active,
            start_date::text AS start_date, end_date::text AS end_date
     FROM lab_budgets WHERE lab_id = $1 ORDER BY id DESC LIMIT 1`,
    [labId]
  );
  return res.rows[0] ?? null;
}

export async function budgetTotals(db: Db, budgetId: number): Promise<{ committed: number; spent: number }> {
  const res = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN entry_type = 'commit' THEN amount WHEN entry_type = 'release' THEN -amount ELSE 0 END), 0) AS committed,
       COALESCE(SUM(CASE WHEN entry_type = 'spend' THEN amount ELSE 0 END), 0) AS spent
     FROM budget_ledger WHERE budget_id = $1`,
    [budgetId]
  );
  return { committed: round2(toNumber(res.rows[0].committed)), spent: round2(toNumber(res.rows[0].spent)) };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}

export function summarise(budget: Row | null, totals: { committed: number; spent: number }, today: string): BudgetSummary {
  if (!budget) {
    return {
      budget_id: null,
      period_label: null,
      start_date: null,
      end_date: null,
      allocated: 0,
      committed: 0,
      spent: 0,
      available: 0,
      percent_used: 0,
      burn_rate_per_day: 0,
      projected_exhaustion_date: null,
    };
  }
  const allocated = round2(toNumber(budget.allocated));
  const { committed, spent } = totals;
  const available = round2(allocated - committed - spent);
  const elapsed = Math.min(Math.max(daysBetween(budget.start_date, today) + 1, 1), Math.max(daysBetween(budget.start_date, budget.end_date) + 1, 1));
  const burn = round2(spent / elapsed);
  let projected: string | null = null;
  if (burn > 0) {
    const days = available > 0 ? Math.floor(available / burn) : 0;
    const date = new Date(Date.parse(today) + days * 86400000);
    projected = date.toISOString().slice(0, 10);
  }
  return {
    budget_id: Number(budget.id),
    period_label: budget.period_label,
    start_date: budget.start_date,
    end_date: budget.end_date,
    allocated,
    committed,
    spent,
    available,
    percent_used: allocated > 0 ? Math.round(((committed + spent) / allocated) * 1000) / 10 : 0,
    burn_rate_per_day: burn,
    projected_exhaustion_date: projected,
  };
}

export async function todayIso(db: Db): Promise<string> {
  const res = await db.query<{ today: string }>('SELECT CURRENT_DATE::text AS today');
  return res.rows[0].today;
}

export async function getBudgetSummary(db: Db, labId: number): Promise<BudgetSummary> {
  const budget = await activeBudget(db, labId);
  if (!budget) return summarise(null, { committed: 0, spent: 0 }, await todayIso(db));
  return summarise(budget, await budgetTotals(db, Number(budget.id)), await todayIso(db));
}

export interface AvailabilityCheck {
  ok: boolean;
  available: number;
  shortfall: number;
  has_budget: boolean;
}

// Checks whether `amount` fits in the lab's available budget. Callers lock the budget row first
// (see lockBudget) so the answer still holds when they write their commit.
export async function assertBudgetAvailable(db: Db, labId: number, amount: number): Promise<AvailabilityCheck> {
  const summary = await getBudgetSummary(db, labId);
  if (summary.budget_id === null) {
    return { ok: false, available: 0, shortfall: round2(amount), has_budget: false };
  }
  const shortfall = round2(Math.max(0, amount - summary.available));
  return { ok: shortfall === 0, available: summary.available, shortfall, has_budget: true };
}

// Serialises ledger writes and budget checks for one budget (row lock held until the transaction ends).
export async function lockBudget(tx: Db, budgetId: number): Promise<void> {
  await tx.query('SELECT id FROM lab_budgets WHERE id = $1 FOR UPDATE', [budgetId]);
}

export interface BudgetInput {
  period_label: string;
  start_date: string;
  end_date: string;
  allocated: number;
}

// Creates the lab's active budget, or edits it in place. Editing in place keeps every ledger entry
// pointing at the same budget. An allocation cannot drop below what is already committed or spent.
export async function upsertBudget(tx: Db, labId: number, input: BudgetInput, actorId: number): Promise<Row> {
  if (input.end_date < input.start_date) fail(400, 'VALIDATION_ERROR', 'end_date: The end date must be on or after the start date.');
  const allocated = round2(input.allocated);
  const existing = await activeBudget(tx, labId);

  if (!existing) {
    const res = await tx.query(
      `INSERT INTO lab_budgets (lab_id, period_label, start_date, end_date, allocated, is_active, created_by)
       VALUES ($1, $2, $3::date, $4::date, $5, true, $6) RETURNING id`,
      [labId, input.period_label.trim(), input.start_date, input.end_date, allocated, actorId]
    );
    const id = Number(res.rows[0].id);
    await writeAudit(tx, { actorId, action: 'budget.create', entityType: 'budget', entityId: id, labId, newValue: { ...input, allocated } });
    return (await activeBudget(tx, labId)) as Row;
  }

  const budgetId = Number(existing.id);
  await lockBudget(tx, budgetId);
  const totals = await budgetTotals(tx, budgetId);
  if (allocated < round2(totals.committed + totals.spent)) {
    fail(
      400,
      'ALLOCATION_TOO_LOW',
      `The allocation cannot be below ${round2(totals.committed + totals.spent)} already committed or spent.`,
      { committed_or_spent: round2(totals.committed + totals.spent) }
    );
  }

  await tx.query(
    `UPDATE lab_budgets SET period_label = $1, start_date = $2::date, end_date = $3::date, allocated = $4 WHERE id = $5`,
    [input.period_label.trim(), input.start_date, input.end_date, allocated, budgetId]
  );
  await writeAudit(tx, {
    actorId,
    action: 'budget.update',
    entityType: 'budget',
    entityId: budgetId,
    labId,
    oldValue: { allocated: toNumber(existing.allocated), period_label: existing.period_label, start_date: existing.start_date, end_date: existing.end_date },
    newValue: { ...input, allocated },
  });
  await checkBudgetThresholds(tx, labId, budgetId);
  return (await activeBudget(tx, labId)) as Row;
}

export interface LedgerInput {
  labId: number;
  budgetId: number;
  poId?: number | null;
  entryType: 'commit' | 'release' | 'spend' | 'adjustment';
  amount: number;
  note?: string;
  userId: number | null;
}

// The only way to insert into budget_ledger. Runs inside the caller's transaction, writes an audit row,
// and sends threshold notifications when usage crosses 75%, 90% or 100%.
export async function recordLedgerEntry(tx: Db, input: LedgerInput): Promise<void> {
  const amount = round2(input.amount);
  if (!(amount > 0)) return;

  await lockBudget(tx, input.budgetId);
  await tx.query(
    `INSERT INTO budget_ledger (lab_id, budget_id, po_id, entry_type, amount, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.labId, input.budgetId, input.poId ?? null, input.entryType, amount, input.note ?? '', input.userId]
  );

  await writeAudit(tx, {
    actorId: input.userId,
    action: `budget.${input.entryType}`,
    entityType: 'budget',
    entityId: input.budgetId,
    labId: input.labId,
    newValue: { amount, po_id: input.poId ?? null },
  });

  if (input.entryType === 'commit' || input.entryType === 'spend') {
    await checkBudgetThresholds(tx, input.labId, input.budgetId);
  }
}

export async function checkBudgetThresholds(tx: Db, labId: number, budgetId: number): Promise<void> {
  const budgetRes = await tx.query('SELECT allocated FROM lab_budgets WHERE id = $1', [budgetId]);
  const allocated = toNumber(budgetRes.rows[0]?.allocated);
  if (allocated <= 0) return;

  const totals = await budgetTotals(tx, budgetId);
  const percent = ((totals.committed + totals.spent) / allocated) * 100;
  const recipients = await labRecipientIds(tx, labId);

  for (const threshold of BUDGET_THRESHOLDS) {
    if (percent < threshold) continue;
    await notifyUsers(
      tx,
      recipients,
      {
        labId,
        type: 'budget_threshold',
        title: `Budget ${threshold}% used`,
        body: `Committed and spent amounts have reached ${threshold}% of this lab's allocation.`,
        link: `/budget?budget=${budgetId}&threshold=${threshold}`,
      },
      { dedupe: true }
    );
  }
}
