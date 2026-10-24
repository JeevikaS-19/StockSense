import { Router } from 'express';
import { db } from '../db.ts';
import { asyncHandler } from '../middleware/validate.ts';
import { requireAuth, isAdmin, type AuthRequest } from '../middleware/auth.ts';
import { fail } from '../errors.ts';

export const notificationsRouter = Router();

// The bell: the current user's latest notifications and unread count. Admins also see open restock requests.
notificationsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = req.user!.id;
    const rows = await db.query(
      `SELECT n.id, n.lab_id, n.type, n.title, n.body, n.link, n.is_read, n.created_at, l.code AS lab_code
       FROM notifications n LEFT JOIN labs l ON l.id = n.lab_id
       WHERE n.user_id = $1 ORDER BY n.is_read ASC, n.id DESC LIMIT 30`,
      [userId]
    );
    const unread = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = false', [userId]);
    let openRequests = 0;
    if (isAdmin(req.user!)) {
      const open = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM restock_requests WHERE status = 'open'");
      openRequests = open.rows[0].n;
    }
    res.json({
      notifications: rows.rows.map((row) => ({ ...row, id: Number(row.id), lab_id: row.lab_id === null ? null : Number(row.lab_id) })),
      unread_count: unread.rows[0].n,
      open_restock_requests: openRequests,
    });
  })
);

notificationsRouter.post(
  '/read-all',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    await db.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false', [req.user!.id]);
    res.json({ success: true });
  })
);

notificationsRouter.post(
  '/:id/read',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const updated = await db.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING id',
      [Number(req.params.id), req.user!.id]
    );
    if (updated.rows.length === 0) fail(404, 'NOT_FOUND', 'Notification not found.');
    res.json({ success: true });
  })
);
