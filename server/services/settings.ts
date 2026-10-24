import { db, type Db } from '../db.ts';
import { writeAudit } from './audit.ts';

export const DEFAULT_INSTITUTION = 'REVA University';

export async function getSettings(): Promise<Record<string, string>> {
  const res = await db.query<{ key: string; value: string }>('SELECT key, value FROM app_settings');
  return Object.fromEntries(res.rows.map((row) => [row.key, row.value]));
}

export async function getInstitutionName(): Promise<string> {
  const settings = await getSettings();
  return settings.institution_name || DEFAULT_INSTITUTION;
}

export async function updateSettings(tx: Db, actorId: number, values: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    const old = await tx.query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [key]);
    await tx.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value]
    );
    await writeAudit(tx, {
      actorId,
      action: 'settings.update',
      entityType: 'setting',
      entityId: key,
      oldValue: old.rows[0]?.value ?? null,
      newValue: value,
    });
  }
}
