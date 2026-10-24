import { Router } from 'express';
import { asyncHandler } from '../middleware/validate.ts';
import { requireAdmin, requireAuth } from '../middleware/auth.ts';
import { seedDemoData } from '../services/demo.ts';
import { runAutomationForAllLabs } from '../services/automation.ts';

export const adminRouter = Router();

// POST /api/admin/demo-data - replaces all business data with the demo dataset. The signed-in user
// is removed by the reset, so the response tells the client to sign in again with the demo admin.
adminRouter.post(
  '/demo-data',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const summary = await seedDemoData();
    res.json({ success: true, ...summary });
  })
);

// POST /api/admin/automation/run - "Run automation now".
adminRouter.post(
  '/automation/run',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ labs: await runAutomationForAllLabs() });
  })
);
