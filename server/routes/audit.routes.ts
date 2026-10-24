import { Router } from 'express';
import { db } from '../db.ts';
import { asyncHandler } from '../middleware/validate.ts';
import { requireAdmin, requireAuth, type AuthRequest } from '../middleware/auth.ts';

export const auditRouter = Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The audit log is read-only. There are no endpoints to edit or delete audit rows, budget ledger
// entries, transactions or goods receipts.
auditRouter.get(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    const from = String(req.query.from ?? '');
    const to = String(req.query.to ?? '');
    if (DATE.test(from)) add('a.created_at::date >= ?::date', from);
    if (DATE.test(to)) add('a.created_at::date <= ?::date', to);
    if (req.query.user_id) add('a.actor_id = ?', Number(req.query.user_id));
    if (req.query.lab_id) add('a.lab_id = ?', Number(req.query.lab_id));
    if (req.query.entity_type) add('a.entity_type = ?', String(req.query.entity_type));
    if (req.query.action) add('a.action LIKE ?', `${String(req.query.action)}%`);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await db.query(
      `SELECT a.id, a.created_at, a.action, a.entity_type, a.entity_id, a.lab_id, a.old_value, a.new_value,
              a.actor_id, u.name AS actor_name, l.code AS lab_code
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
       LEFT JOIN labs l ON l.id = a.lab_id
       ${whereSql}
       ORDER BY a.id DESC LIMIT ${req.query.format === 'csv' ? 5000 : 200}`,
      params
    );

    if (req.query.format === 'csv') {
      const escape = (value: unknown) => {
        const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const header = ['id', 'created_at', 'actor', 'action', 'entity_type', 'entity_id', 'lab', 'old_value', 'new_value'];
      const lines = rows.rows.map((row) =>
        [row.id, new Date(row.created_at).toISOString(), row.actor_name, row.action, row.entity_type, row.entity_id, row.lab_code, row.old_value, row.new_value].map(escape).join(',')
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
      res.send([header.join(','), ...lines].join('\n') + '\n');
      return;
    }

    res.json({
      entries: rows.rows.map((row) => ({ ...row, id: Number(row.id), actor_id: row.actor_id === null ? null : Number(row.actor_id) })),
    });
  })
);
