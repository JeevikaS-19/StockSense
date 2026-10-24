import { Router } from 'express';
import { z } from 'zod';
import { db, withTransaction } from '../db.ts';
import { fail } from '../errors.ts';
import { asyncHandler, nullableInt, parse } from '../middleware/validate.ts';
import { assertLabAccess, isAdmin, requireAuth, type AuthRequest } from '../middleware/auth.ts';
import { buildReport, reportToCsv, REPORT_TYPES, type ReportData } from '../services/reports.ts';
import { nextNumber, pad } from '../services/sequences.ts';
import { getInstitutionName } from '../services/settings.ts';

export const reportsRouter = Router();

const querySchema = z.object({
  report_type: z.enum(REPORT_TYPES, { message: 'Choose a report type' }),
  lab_id: nullableInt(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

interface Scope {
  labIds: number[] | null; // null = every lab the user can see (admin)
  singleLab: { id: number; name: string; code: string } | null;
}

// One lab (access checked), or every lab the user can see.
async function reportScope(req: AuthRequest, labId: number | null): Promise<Scope> {
  if (labId) {
    await assertLabAccess(req.user!, labId);
    const lab = await db.query<{ name: string; code: string }>('SELECT name, code FROM labs WHERE id = $1', [labId]);
    if (lab.rows.length === 0) fail(404, 'NOT_FOUND', 'Laboratory not found.');
    return { labIds: [labId], singleLab: { id: labId, name: lab.rows[0].name, code: lab.rows[0].code } };
  }
  if (isAdmin(req.user!)) return { labIds: null, singleLab: null };
  const mine = await db.query('SELECT lab_id FROM lab_members WHERE user_id = $1', [req.user!.id]);
  return { labIds: mine.rows.map((row) => Number(row.lab_id)), singleLab: null };
}

async function generate(req: AuthRequest, input: z.infer<typeof querySchema>): Promise<ReportData> {
  const scope = await reportScope(req, input.lab_id ?? null);
  return buildReport(db, {
    type: input.report_type,
    labIds: scope.labIds,
    singleLab: scope.singleLab,
    from: input.from ?? undefined,
    to: input.to ?? undefined,
  });
}

// POST /api/reports - generates the report, records it in reports_log, and returns it with its number.
reportsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const input = parse(querySchema, req.body ?? {});
    const report = await generate(req, input);
    const reportNo = await withTransaction(async (tx) => {
      const now = new Date();
      const day = Number(`${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}`);
      const seq = await nextNumber(tx, 0, 'RPT', day);
      const no = `RPT-${day}-${pad(seq)}`;
      await tx.query(
        'INSERT INTO reports_log (report_no, report_type, lab_id, params, generated_by) VALUES ($1, $2, $3, $4::jsonb, $5)',
        [no, input.report_type, input.lab_id, JSON.stringify({ from: report.period.from, to: report.period.to }), req.user!.id]
      );
      return no;
    });
    res.status(201).json({
      report_no: reportNo,
      generated_by: req.user!.name,
      generated_at: new Date().toISOString(),
      institution_name: await getInstitutionName(),
      report,
    });
  })
);

// GET /api/reports/csv?report_type=&lab_id=&from=&to= - the same data as CSV.
reportsRouter.get(
  '/csv',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const input = parse(querySchema, {
      report_type: req.query.report_type,
      lab_id: req.query.lab_id,
      from: req.query.from,
      to: req.query.to,
    });
    const report = await generate(req, input);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${input.report_type}-${report.period.from}-to-${report.period.to}.csv"`);
    res.send(reportToCsv(report));
  })
);
