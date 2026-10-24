import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../db.ts';
import { asyncHandler, parse } from '../middleware/validate.ts';
import { requireAdmin, requireAuth, type AuthRequest } from '../middleware/auth.ts';
import { getSettings, updateSettings } from '../services/settings.ts';

export const settingsRouter = Router();

const updateSchema = z.object({
  institution_name: z.string().trim().min(2, 'Institution name is required').max(120),
});

settingsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ settings: await getSettings() });
  })
);

settingsRouter.put(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = parse(updateSchema, req.body);
    await withTransaction((tx) => updateSettings(tx, req.user!.id, { institution_name: body.institution_name }));
    res.json({ settings: await getSettings() });
  })
);
