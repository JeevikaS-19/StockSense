import type { Db } from '../db.ts';

export interface AuditInput {
  actorId: number | null;
  action: string;
  entityType: string;
  entityId?: number | string | null;
  labId?: number | null;
  oldValue?: unknown;
  newValue?: unknown;
}

// Appends one row to audit_log. Called inside the same transaction as the change it describes,
// so an audit row exists if and only if the change committed.
export async function writeAudit(tx: Db, input: AuditInput): Promise<void> {
  await tx.query(
    `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, lab_id, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      input.actorId,
      input.action,
      input.entityType,
      input.entityId === undefined || input.entityId === null ? null : String(input.entityId),
      input.labId ?? null,
      input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
      input.newValue === undefined ? null : JSON.stringify(input.newValue),
    ]
  );
}
