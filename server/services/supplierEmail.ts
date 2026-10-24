import { db, type Db } from '../db.ts';
import { env } from '../env.ts';
import { fail } from '../errors.ts';
import { sendEmail } from './email.ts';

export function supplierPortalUrl(token: string): string {
  return `${env.appUrl}/supplier/po/${token}`;
}

// Emails the supplier the public link to their PO. Skipped silently when no email or no RESEND key.
export async function emailSupplierAboutPo(tx: Db | typeof db, poId: number): Promise<boolean> {
  const res = await tx.query(
    `SELECT po.po_number, po.supplier_token, po.expected_date::text AS expected_date, s.email, s.name AS supplier_name, l.name AS lab_name
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN labs l ON l.id = po.lab_id
     WHERE po.id = $1`,
    [poId]
  );
  if (res.rows.length === 0) fail(404, 'NOT_FOUND', 'Purchase order not found.');
  const po = res.rows[0];
  const text = [
    `Dear ${po.supplier_name},`,
    '',
    `Please find purchase order ${po.po_number} from ${po.lab_name}.`,
    po.expected_date ? `Expected delivery: ${po.expected_date}.` : '',
    '',
    `View the order and confirm it here: ${supplierPortalUrl(po.supplier_token)}`,
    '',
    'Thank you.',
  ]
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''))
    .join('\n');
  return sendEmail(po.email, `Purchase order ${po.po_number}`, text);
}
