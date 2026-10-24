import { Router } from 'express';
import { db } from '../db.ts';
import { round2, toNumber } from '../errors.ts';
import { asyncHandler } from '../middleware/validate.ts';
import { assertLabAccess, isAdmin, requireAuth, type AuthRequest } from '../middleware/auth.ts';
import { getBudgetSummary } from '../services/budget.ts';

export const dashboardRouter = Router();

// GET /api/dashboard/stats?lab_id=<id>|all
dashboardRouter.get(
  '/stats',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const user = req.user!;
    const labParam = String(req.query.lab_id ?? '');
    const allLabs = labParam === 'all';
    if (allLabs && !isAdmin(user)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only administrators may view the all-labs overview.' } });
    }

    let labId: number | null = null;
    if (!allLabs) {
      labId = Number(labParam);
      if (!Number.isInteger(labId) || labId <= 0) {
        return res.status(400).json({ error: { code: 'INVALID_LAB_ID', message: 'A valid laboratory is required.' } });
      }
      await assertLabAccess(user, labId);
    }

    const scopeParams: unknown[] = allLabs ? [] : [labId];
    const productScope = allLabs ? '' : 'AND lab_id = $1';
    const txScope = allLabs ? '' : 'AND t.lab_id = $1';

    const kpi = await db.query(
      `SELECT COUNT(*)::int AS total_products,
         COALESCE(SUM(quantity * unit_price), 0) AS total_stock_value,
         COUNT(*) FILTER (WHERE quantity <= reorder_level AND quantity > 0)::int AS low_stock_count,
         COUNT(*) FILTER (WHERE quantity = 0)::int AS out_of_stock_count
       FROM products WHERE is_active = true ${productScope}`,
      scopeParams
    );

    // The database builds the 30-day calendar and buckets the movements, so both use the same dates.
    const series = await db.query<{ date: string; display_date: string }>(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS date, to_char(d::date, 'Mon FMDD') AS display_date
       FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, interval '1 day') AS d ORDER BY d`
    );
    const days: Record<string, { date: string; display_date: string; stock_in: number; stock_out: number }> = {};
    for (const row of series.rows) {
      days[row.date] = { date: row.date, display_date: row.display_date, stock_in: 0, stock_out: 0 };
    }

    const flow = await db.query(
      `SELECT to_char(t.created_at::date, 'YYYY-MM-DD') AS date, t.type, SUM(t.quantity) AS total_qty
       FROM transactions t WHERE t.created_at::date >= CURRENT_DATE - 29 ${txScope}
       GROUP BY 1, 2`,
      scopeParams
    );
    for (const row of flow.rows) {
      const day = days[row.date];
      if (!day) continue;
      if (row.type === 'IN') day.stock_in += toNumber(row.total_qty);
      else day.stock_out += toNumber(row.total_qty);
    }

    const topIssued = await db.query(
      `SELECT t.product_name, SUM(t.quantity) AS total_issued
       FROM transactions t WHERE t.type = 'OUT' AND t.created_at::date >= CURRENT_DATE - 29 ${txScope}
       GROUP BY t.product_name ORDER BY total_issued DESC, t.product_name LIMIT 5`,
      scopeParams
    );

    const recent = await db.query(
      `SELECT t.id, t.lab_id, t.product_name, t.type, t.quantity, t.balance_after, t.party, t.created_at,
              u.name AS user_name, l.name AS lab_name
       FROM transactions t
       LEFT JOIN users u ON u.id = t.user_id
       JOIN labs l ON l.id = t.lab_id
       WHERE 1 = 1 ${txScope}
       ORDER BY t.created_at DESC, t.id DESC LIMIT 8`,
      allLabs ? [] : [labId]
    );

    let allLabsOverview: any[] = [];
    if (allLabs) {
      const labs = await db.query(
        `SELECT l.id, l.name, l.department, l.location,
           COUNT(p.id) FILTER (WHERE p.is_active)::int AS product_count,
           COALESCE(SUM(p.quantity * p.unit_price) FILTER (WHERE p.is_active), 0) AS stock_value,
           COUNT(p.id) FILTER (WHERE p.is_active AND p.quantity <= p.reorder_level AND p.quantity > 0)::int AS low_stock_count,
           COUNT(p.id) FILTER (WHERE p.is_active AND p.quantity = 0)::int AS out_of_stock_count
         FROM labs l LEFT JOIN products p ON p.lab_id = l.id
         GROUP BY l.id, l.name, l.department, l.location ORDER BY l.name`
      );
      allLabsOverview = [];
      for (const row of labs.rows) {
        const budget = await getBudgetSummary(db, Number(row.id));
        allLabsOverview.push({
          ...row,
          id: Number(row.id),
          stock_value: round2(toNumber(row.stock_value)),
          budget_available: budget.available,
          budget_percent_used: budget.percent_used,
          budget_allocated: budget.allocated,
        });
      }
    }

    const budget = labId !== null ? await getBudgetSummary(db, labId) : null;
    const k = kpi.rows[0];

    res.json({
      kpis: {
        total_products: toNumber(k.total_products),
        total_stock_value: round2(toNumber(k.total_stock_value)),
        low_stock_count: toNumber(k.low_stock_count),
        out_of_stock_count: toNumber(k.out_of_stock_count),
      },
      flow_30_days: Object.values(days),
      top_issued: topIssued.rows.map((row) => ({ name: row.product_name, issued: toNumber(row.total_issued) })),
      recent_transactions: recent.rows.map((row) => ({
        ...row,
        id: Number(row.id),
        quantity: toNumber(row.quantity),
        balance_after: toNumber(row.balance_after),
      })),
      all_labs_overview: allLabsOverview,
      budget,
    });
  })
);
