import cron, { type ScheduledTask } from 'node-cron';
import { db, withTransaction } from '../db.ts';
import { env } from '../env.ts';
import { toNumber } from '../errors.ts';
import { scanLabForReorders } from './reorder.ts';
import { approvePurchaseOrder, sendPurchaseOrder, submitPurchaseOrder } from './purchaseOrders.ts';
import { notifyAdmins } from './notifications.ts';
import { emailSupplierAboutPo } from './supplierEmail.ts';
import { inr } from './format.ts';

export interface LabAutomationResult {
  lab_id: number;
  lab_code: string;
  mode: string;
  created_pos: number;
  items_added: number;
  auto_sent: string[];
  needs_review: string[];
}

// Runs the reorder scan for one lab and, in auto_send mode, pushes qualifying drafts through
// submit -> approve -> send as the system actor (actor_id null). Drafts that do not qualify stay as drafts
// and an admin is told to review them.
export async function runAutomationForLab(labId: number): Promise<LabAutomationResult> {
  const labRes = await db.query('SELECT id, code, automation_mode, auto_approve_limit FROM labs WHERE id = $1', [labId]);
  const lab = labRes.rows[0];
  const result: LabAutomationResult = {
    lab_id: labId,
    lab_code: lab.code,
    mode: lab.automation_mode,
    created_pos: 0,
    items_added: 0,
    auto_sent: [],
    needs_review: [],
  };

  const scan = await withTransaction((tx) => scanLabForReorders(tx, labId, null));
  result.created_pos = scan.created_pos;
  result.items_added = scan.items_added;

  if (lab.automation_mode !== 'auto_send') return result;

  const limit = toNumber(lab.auto_approve_limit);
  const drafts = await db.query(
    "SELECT id, po_number, total FROM purchase_orders WHERE lab_id = $1 AND status = 'draft' ORDER BY id",
    [labId]
  );

  for (const draft of drafts.rows) {
    const total = toNumber(draft.total);
    const poId = Number(draft.id);
    if (!(total > 0) || total > limit) {
      await reviewNeeded(labId, poId, draft.po_number, total > 0 ? `Total ${inr(total)} is above the auto-approve limit of ${inr(limit)}.` : 'Empty draft.');
      result.needs_review.push(draft.po_number);
      continue;
    }
    try {
      await withTransaction(async (tx) => {
        await submitPurchaseOrder(tx, poId, null);
        await approvePurchaseOrder(tx, poId, null);
        await sendPurchaseOrder(tx, poId, null);
      });
      await emailSupplierAboutPo(db, poId).catch(() => false);
      result.auto_sent.push(draft.po_number);
    } catch (err: any) {
      // Budget shortfalls and similar block the send; the draft is left for an admin to review.
      await reviewNeeded(labId, poId, draft.po_number, err.message);
      result.needs_review.push(draft.po_number);
    }
  }
  return result;
}

async function reviewNeeded(labId: number, poId: number, poNumber: string, reason: string): Promise<void> {
  await withTransaction((tx) =>
    notifyAdmins(
      tx,
      {
        labId,
        type: 'po_needs_review',
        title: `Draft PO needs review: ${poNumber}`,
        body: reason,
        link: `/purchase-orders/${poId}`,
      },
      { dedupe: true }
    )
  );
}

export async function runAutomationForAllLabs(): Promise<LabAutomationResult[]> {
  const labs = await db.query('SELECT id FROM labs ORDER BY id');
  const results: LabAutomationResult[] = [];
  for (const lab of labs.rows) {
    results.push(await runAutomationForLab(Number(lab.id)));
  }
  return results;
}

let task: ScheduledTask | null = null;

// Every 15 minutes, as specified. Errors are logged, never thrown into the scheduler.
export function startAutomation(): void {
  if (!env.automationEnabled || task) return;
  task = cron.schedule('*/15 * * * *', () => {
    runAutomationForAllLabs().catch((err) => console.error('[StockSense Automation] Run failed:', err));
  });
  console.log('[StockSense Automation] Scheduled every 15 minutes.');
}

export function stopAutomation(): void {
  task?.stop();
  task = null;
}
