import type { Db } from '../db.ts';

// Gap-free document numbering. The upsert takes a row lock on the sequence row, and because it runs
// inside the caller's transaction a rollback also rolls the counter back, so no numbers are skipped.
export async function nextNumber(tx: Db, labId: number, docType: string, year: number): Promise<number> {
  const res = await tx.query<{ last_number: number }>(
    `INSERT INTO doc_sequences (lab_id, doc_type, year, last_number) VALUES ($1, $2, $3, 1)
     ON CONFLICT (lab_id, doc_type, year) DO UPDATE SET last_number = doc_sequences.last_number + 1
     RETURNING last_number`,
    [labId, docType, year]
  );
  return Number(res.rows[0].last_number);
}

export function pad(n: number, width = 4): string {
  return String(n).padStart(width, '0');
}

export function currentYear(): number {
  return new Date().getFullYear();
}
