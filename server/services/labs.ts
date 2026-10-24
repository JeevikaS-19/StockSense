import type { Db } from '../db.ts';
import { fail } from '../errors.ts';
import { writeAudit } from './audit.ts';

// Derives a short lab code from the name ("Electronics & Embedded Systems Lab" -> "EESL"),
// adding a number suffix when the code is taken.
export async function generateLabCode(tx: Db, name: string): Promise<string> {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  let base = words.map((word) => word[0]).join('').slice(0, 4).toUpperCase();
  if (base.length < 2) base = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'LAB';

  let candidate = base;
  let suffix = 2;
  for (;;) {
    const taken = await tx.query('SELECT 1 FROM labs WHERE code = $1', [candidate]);
    if (taken.rows.length === 0) return candidate;
    candidate = `${base}${suffix++}`;
  }
}

export interface LabInput {
  name: string;
  department: string;
  location: string;
  code?: string;
  automation_mode?: 'alert_only' | 'draft_po' | 'auto_send';
  auto_approve_limit?: number;
  safety_days?: number;
}

export async function createLab(tx: Db, input: LabInput, actorId: number): Promise<Record<string, any>> {
  let code: string;
  if (input.code) {
    code = input.code.trim().toUpperCase();
    const taken = await tx.query('SELECT 1 FROM labs WHERE code = $1', [code]);
    if (taken.rows.length > 0) fail(409, 'LAB_CODE_EXISTS', `The lab code ${code} is already used by another lab.`);
  } else {
    code = await generateLabCode(tx, input.name);
  }
  const res = await tx.query(
    `INSERT INTO labs (name, department, location, code) VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.name.trim(), input.department.trim(), input.location.trim(), code]
  );
  const lab = res.rows[0];
  await tx.query('INSERT INTO lab_members (lab_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [lab.id, actorId]);
  await writeAudit(tx, { actorId, action: 'lab.create', entityType: 'lab', entityId: lab.id, labId: Number(lab.id), newValue: { name: lab.name, code } });
  return lab;
}

// Updates a lab. Only the fields present in `input` change; the old and new values are audited.
export async function updateLab(tx: Db, labId: number, input: Partial<LabInput>, actorId: number): Promise<Record<string, any>> {
  const currentRes = await tx.query('SELECT * FROM labs WHERE id = $1 FOR UPDATE', [labId]);
  if (currentRes.rows.length === 0) fail(404, 'NOT_FOUND', 'Laboratory not found.');
  const before = currentRes.rows[0];

  const next = {
    name: input.name !== undefined ? input.name.trim() : before.name,
    department: input.department !== undefined ? input.department.trim() : before.department,
    location: input.location !== undefined ? input.location.trim() : before.location,
    code: input.code !== undefined ? input.code.trim().toUpperCase() : before.code,
    automation_mode: input.automation_mode ?? before.automation_mode,
    auto_approve_limit: input.auto_approve_limit ?? Number(before.auto_approve_limit),
    safety_days: input.safety_days ?? Number(before.safety_days),
  };

  if (next.code !== before.code) {
    const taken = await tx.query('SELECT 1 FROM labs WHERE code = $1 AND id <> $2', [next.code, labId]);
    if (taken.rows.length > 0) fail(409, 'LAB_CODE_EXISTS', `The lab code ${next.code} is already used by another lab.`);
  }

  const res = await tx.query(
    `UPDATE labs SET name = $1, department = $2, location = $3, code = $4, automation_mode = $5,
       auto_approve_limit = $6, safety_days = $7 WHERE id = $8 RETURNING *`,
    [next.name, next.department, next.location, next.code, next.automation_mode, next.auto_approve_limit, next.safety_days, labId]
  );

  const changed: Record<string, unknown> = {};
  const previous: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    if (String(before[key]) !== String(next[key])) {
      previous[key] = before[key];
      changed[key] = next[key];
    }
  }
  if (Object.keys(changed).length > 0) {
    await writeAudit(tx, { actorId, action: 'lab.update', entityType: 'lab', entityId: labId, labId, oldValue: previous, newValue: changed });
  }
  return res.rows[0];
}
