import type { Db } from '../db.ts';

export interface NotificationInput {
  labId?: number | null;
  type: string;
  title: string;
  body?: string;
  link?: string;
}

export async function adminUserIds(tx: Db): Promise<number[]> {
  const res = await tx.query<{ id: number }>("SELECT id FROM users WHERE role = 'admin' ORDER BY id");
  return res.rows.map((row) => Number(row.id));
}

// Admins plus every staff member assigned to the lab.
export async function labRecipientIds(tx: Db, labId: number): Promise<number[]> {
  const res = await tx.query<{ id: number }>(
    `SELECT id FROM users WHERE role = 'admin'
     UNION
     SELECT user_id AS id FROM lab_members WHERE lab_id = $1
     ORDER BY id`,
    [labId]
  );
  return res.rows.map((row) => Number(row.id));
}

// Writes one notification per recipient. With dedupe, a recipient who already has a notification
// of this type and link is skipped, so repeated checks do not spam.
export async function notifyUsers(
  tx: Db,
  userIds: number[],
  input: NotificationInput,
  options: { dedupe?: boolean } = {}
): Promise<number> {
  const link = input.link ?? '';
  let created = 0;
  for (const userId of Array.from(new Set(userIds))) {
    if (options.dedupe) {
      const existing = await tx.query(
        'SELECT 1 FROM notifications WHERE user_id = $1 AND type = $2 AND link = $3 LIMIT 1',
        [userId, input.type, link]
      );
      if (existing.rows.length > 0) continue;
    }
    await tx.query(
      `INSERT INTO notifications (lab_id, user_id, type, title, body, link)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.labId ?? null, userId, input.type, input.title, input.body ?? '', link]
    );
    created++;
  }
  return created;
}

export function notifyAdmins(tx: Db, input: NotificationInput, options: { dedupe?: boolean } = {}): Promise<number> {
  return adminUserIds(tx).then((ids) => notifyUsers(tx, ids, input, options));
}
