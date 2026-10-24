import { Router } from 'express';
import { z } from 'zod';
import { db, withTransaction } from '../db.ts';
import { fail, toNumber } from '../errors.ts';
import { asyncHandler, validateBody } from '../middleware/validate.ts';
import { requireAuth, requireAdmin, hasLabAccess, type AuthRequest } from '../middleware/auth.ts';
import { createLab, updateLab } from '../services/labs.ts';
import { writeAudit } from '../services/audit.ts';

export const labsRouter = Router();

const labBase = {
  name: z.string().trim().min(2, 'Lab name is required'),
  department: z.string().trim().min(2, 'Department is required'),
  location: z.string().trim().min(2, 'Location is required'),
};

const labCreateSchema = z.object({
  ...labBase,
  code: z.string().trim().regex(/^[A-Za-z0-9]{2,8}$/, 'Lab code must be 2 to 8 letters or digits').optional(),
});

const labUpdateSchema = z.object({
  name: labBase.name.optional(),
  department: labBase.department.optional(),
  location: labBase.location.optional(),
  code: z.string().trim().regex(/^[A-Za-z0-9]{2,8}$/, 'Lab code must be 2 to 8 letters or digits').optional(),
  automation_mode: z.enum(['alert_only', 'draft_po', 'auto_send']).optional(),
  auto_approve_limit: z.coerce.number().min(0, 'Auto-approve limit cannot be negative.').optional(),
  safety_days: z.coerce.number().int().min(0).max(60).optional(),
});

const membersSchema = z.object({
  user_ids: z.array(z.coerce.number().int().positive()),
});

// Labs the user can see. Admins see all labs; staff see their assigned labs.
labsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const user = req.user!;
    const params: unknown[] = [];
    let scope = '';
    if (user.role !== 'admin') {
      params.push(user.id);
      scope = 'WHERE l.id IN (SELECT lab_id FROM lab_members WHERE user_id = $1)';
    }
    const res2 = await db.query(
      `SELECT l.id, l.name, l.department, l.location, l.code, l.automation_mode, l.auto_approve_limit, l.safety_days, l.created_at,
         (SELECT COUNT(*)::int FROM products p WHERE p.lab_id = l.id AND p.is_active = true) AS product_count,
         (SELECT COUNT(*)::int FROM lab_members lm WHERE lm.lab_id = l.id) AS member_count
       FROM labs l ${scope} ORDER BY l.name`,
      params
    );
    res.json({
      labs: res2.rows.map((row) => ({ ...row, id: Number(row.id), auto_approve_limit: toNumber(row.auto_approve_limit) })),
    });
  })
);

labsRouter.post(
  '/',
  requireAuth,
  requireAdmin,
  validateBody(labCreateSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    const lab = await withTransaction((tx) => createLab(tx, req.body, req.user!.id));
    res.status(201).json({ lab: { ...lab, id: Number(lab.id) } });
  })
);

labsRouter.put(
  '/:id',
  requireAuth,
  requireAdmin,
  validateBody(labUpdateSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    const labId = Number(req.params.id);
    const lab = await withTransaction((tx) => updateLab(tx, labId, req.body, req.user!.id));
    res.json({ lab: { ...lab, id: Number(lab.id), auto_approve_limit: toNumber(lab.auto_approve_limit) } });
  })
);

// Members of one lab plus every user, for the assignment picker (admin).
labsRouter.get(
  '/:id/members',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const labId = Number(req.params.id);
    const members = await db.query(
      `SELECT u.id, u.name, u.email, u.role FROM users u
       JOIN lab_members lm ON lm.user_id = u.id WHERE lm.lab_id = $1 ORDER BY u.name`,
      [labId]
    );
    const users = await db.query('SELECT id, name, email, role FROM users ORDER BY name');
    res.json({ members: members.rows, available_users: users.rows });
  })
);

// Replaces the lab's membership list in one transaction.
labsRouter.post(
  '/:id/members',
  requireAuth,
  requireAdmin,
  validateBody(membersSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    const labId = Number(req.params.id);
    const userIds = Array.from(new Set<number>(req.body.user_ids));
    await withTransaction(async (tx) => {
      const lab = await tx.query('SELECT 1 FROM labs WHERE id = $1', [labId]);
      if (lab.rows.length === 0) fail(404, 'NOT_FOUND', 'Laboratory not found.');
      const before = await tx.query('SELECT user_id FROM lab_members WHERE lab_id = $1', [labId]);
      await tx.query('DELETE FROM lab_members WHERE lab_id = $1', [labId]);
      for (const userId of userIds) {
        await tx.query('INSERT INTO lab_members (lab_id, user_id) VALUES ($1, $2)', [labId, userId]);
      }
      await writeAudit(tx, {
        actorId: req.user!.id,
        action: 'lab.members_set',
        entityType: 'lab',
        entityId: labId,
        labId,
        oldValue: before.rows.map((row) => Number(row.user_id)),
        newValue: userIds,
      });
    });
    res.json({ success: true, count: userIds.length });
  })
);

// Removes one staff member from a lab (the "Remove" action on the Labs & Team page).
labsRouter.delete(
  '/:id/members/:userId',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const labId = Number(req.params.id);
    const userId = Number(req.params.userId);
    await withTransaction(async (tx) => {
      const removed = await tx.query('DELETE FROM lab_members WHERE lab_id = $1 AND user_id = $2 RETURNING user_id', [labId, userId]);
      if (removed.rows.length === 0) fail(404, 'NOT_FOUND', 'That user is not a member of this laboratory.');
      await writeAudit(tx, {
        actorId: req.user!.id,
        action: 'lab.member_remove',
        entityType: 'lab',
        entityId: labId,
        labId,
        oldValue: { user_id: userId },
      });
    });
    res.json({ success: true });
  })
);

// Used by the lab switcher and other lab-scoped screens to check access before loading lab data.
labsRouter.get(
  '/:id/access',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    res.json({ allowed: await hasLabAccess(req.user!, Number(req.params.id)) });
  })
);
