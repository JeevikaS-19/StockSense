import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, downloadFile, errorMessage } from '../api/client.ts';
import { ReportData } from '../types/index.ts';
import { buttonPrimary, buttonSecondary, EmptyState, ErrorBanner, inputClass } from '../components/common/Field.tsx';
import { PageLoading } from '../components/common/Skeleton.tsx';
import { Printer, Download, Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import { money, quantity, dateOnly, dateTime } from '../lib/format.ts';

interface Generated {
  report_no: string;
  generated_by: string;
  generated_at: string;
  institution_name: string;
  report: ReportData;
}

const cell = (value: unknown, type: string) => {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'money') return money(Number(value));
  if (type === 'number') return quantity(Number(value));
  return String(value);
};

// Printable report. The generation is recorded once per opened preview; printing does not create another record.
export const ReportPreviewPage: React.FC = () => {
  const [params] = useSearchParams();
  const [data, setData] = useState<Generated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ text: string; source: string } | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const body = {
      report_type: params.get('report_type'),
      lab_id: params.get('lab_id') ? Number(params.get('lab_id')) : null,
      from: params.get('from') || null,
      to: params.get('to') || null,
    };
    api.reports
      .generate(body)
      .then((res) => setData(res))
      .catch((err) => setError(errorMessage(err, 'Could not generate this report.')));
  }, [params]);

  const askForSummary = async () => {
    if (!data) return;
    setSummaryBusy(true);
    try {
      const res = await api.ai.reportSummary({
        report_type: data.report.type,
        lab_id: data.report.lab?.id ?? null,
        from: data.report.period.from,
        to: data.report.period.to,
      });
      setSummary({ text: res.text, source: res.source });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSummaryBusy(false);
    }
  };

  if (error) return <EmptyState title="Report not available" text={error} action={<Link to="/reports" className={buttonSecondary}>Back to reports</Link>} />;
  if (!data) return <div className="p-8"><PageLoading label="Generating report" /></div>;

  const r = data.report;

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-2">
        <Link to="/reports" className="text-sm text-slate-600 hover:text-slate-900">← Reports</Link>
        <div className="flex gap-2">
          <button type="button" className={buttonSecondary} onClick={() => downloadFile(`/api/reports/csv?${params.toString()}`, `${r.type}.csv`).catch((err) => setError(errorMessage(err)))}>
            <Download className="h-4 w-4" /> CSV
          </button>
          <button type="button" className={buttonPrimary} onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print / Save as PDF
          </button>
        </div>
      </div>

      <article className="print-doc mx-auto flex w-full max-w-[210mm] flex-col bg-white p-[14mm] text-[11px] leading-snug text-slate-900 shadow-sm print:shadow-none">
        <header className="flex items-start justify-between gap-4 border-b-2 border-slate-900 pb-3">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide">{data.institution_name}</p>
            <p className="text-[11px] text-slate-600">{r.lab ? `${r.lab.name} (${r.lab.code})` : 'All laboratories'}</p>
          </div>
          <div className="text-right">
            <h1 className="text-base font-bold">{r.title}</h1>
            <p className="font-mono text-[11px]">{data.report_no}</p>
            <p className="text-[11px] text-slate-600">Period: {dateOnly(r.period.from)} to {dateOnly(r.period.to)}</p>
            <p className="text-[11px] text-slate-600">Generated {dateTime(data.generated_at)} by {data.generated_by}</p>
          </div>
        </header>

        {r.reconciliation && (
          <p className={`mt-3 rounded px-2 py-1 text-[11px] font-medium ${r.reconciliation.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
            {r.reconciliation.ok ? 'Reconciled: closing quantities match current stock.' : `${r.reconciliation.mismatches} product${r.reconciliation.mismatches === 1 ? '' : 's'} do not reconcile with current stock. Investigate before sign-off.`}
          </p>
        )}

        {r.sections.map((section) => (
          <section key={section.title} className="mt-5">
            <h2 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide">{section.title}</h2>
            {section.rows.length === 0 ? (
              <p className="py-2 text-slate-500">No records in this period.</p>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-y border-slate-900 text-left">
                    {r.type === 'purchase_register' && <th className="w-5 py-1" aria-label="Expand" />}
                    {section.columns.map((col) => (
                      <th key={col.key} className={`py-1 pr-2 ${col.type !== 'text' ? 'text-right' : ''}`}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row, index) => {
                    const key = `${section.title}-${index}`;
                    const hasLines = Array.isArray(row.lines) && row.lines.length > 0;
                    const flagged = r.type === 'stock_ledger' && Number(row.difference) !== 0;
                    return (
                      <React.Fragment key={key}>
                        <tr className={`border-b border-slate-200 align-top ${flagged ? 'text-rose-700' : ''}`}>
                          {r.type === 'purchase_register' && (
                            <td className="py-1">
                              {hasLines && (
                                <button type="button" className="no-print text-slate-500" onClick={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))} aria-label="Show lines">
                                  {expanded[key] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                </button>
                              )}
                            </td>
                          )}
                          {section.columns.map((col) => (
                            <td key={col.key} className={`py-1 pr-2 ${col.type !== 'text' ? 'text-right font-mono tabular-nums' : ''} ${flagged && col.key === 'difference' ? 'font-bold' : ''}`}>
                              {cell(row[col.key], col.type)}
                            </td>
                          ))}
                        </tr>
                        {expanded[key] &&
                          hasLines &&
                          row.lines.map((line: any, li: number) => (
                            <tr key={`${key}-${li}`} className="text-slate-600">
                              <td />
                              <td className="py-0.5 pl-4" colSpan={Math.max(1, section.columns.length - 3)}>
                                {line.description}
                              </td>
                              <td className="py-0.5 pr-2 text-right font-mono">{quantity(line.ordered)} ord · {quantity(line.received)} rec</td>
                              <td className="py-0.5 pr-2 text-right font-mono">{money(line.unit_price)}</td>
                              <td className="py-0.5 text-right font-mono">{money(line.line_total)}</td>
                            </tr>
                          ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                {section.totals && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-900 font-semibold">
                      {r.type === 'purchase_register' && <td />}
                      {section.columns.map((col) => (
                        <td key={col.key} className={`py-1.5 pr-2 ${col.type !== 'text' ? 'text-right font-mono tabular-nums' : ''}`}>
                          {section.totals![col.key] !== undefined && section.totals![col.key] !== null ? cell(section.totals![col.key], col.type) : ''}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
            {section.note && <p className="mt-1.5 text-[10px] text-slate-500">{section.note}</p>}
          </section>
        ))}

        {r.notes.length > 0 && <p className="mt-3 text-[10px] text-slate-500">{r.notes.join(' ')}</p>}

        <section className="no-print mt-6 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-700"><Sparkles className="h-3.5 w-3.5 text-indigo-600" /> Plain-English summary</p>
            <button type="button" className={buttonSecondary} onClick={askForSummary} disabled={summaryBusy}>
              {summaryBusy ? 'Writing…' : summary ? 'Write again' : 'Generate summary'}
            </button>
          </div>
          {summary && (
            <>
              <label htmlFor="ai-summary" className="block text-xs text-slate-600">AI-assisted summary, review before use</label>
              <textarea id="ai-summary" rows={4} className={inputClass} value={summary.text} onChange={(e) => setSummary({ ...summary, text: e.target.value })} />
            </>
          )}
        </section>
        {summary && (
          <section className="mt-4 text-[11px]">
            <p className="font-semibold">Summary</p>
            <p>{summary.text}</p>
          </section>
        )}

        <div className="mt-auto grid grid-cols-3 gap-6 pt-12 text-[11px]">
          <div className="border-t border-slate-900 pt-1">Prepared by: {data.generated_by}</div>
          <div className="border-t border-slate-900 pt-1">Verified by</div>
          <div className="border-t border-slate-900 pt-1">Approved by</div>
        </div>
        <p className="mt-6 border-t border-slate-200 pt-2 text-[9px] text-slate-500">System-generated report · {data.report_no}</p>
      </article>
    </div>
  );
};
