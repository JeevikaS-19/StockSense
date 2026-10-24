import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLab } from '../context/LabContext.tsx';
import { downloadFile, errorMessage } from '../api/client.ts';
import { useToast } from '../components/common/Toast.tsx';
import { Field, inputClass, buttonPrimary, buttonSecondary, ErrorBanner } from '../components/common/Field.tsx';
import { FileText, Download } from 'lucide-react';

const REPORTS = [
  { value: 'stock_ledger', label: 'Stock ledger', text: 'Opening, receipts, issues and closing quantity per product, reconciled with current stock.' },
  { value: 'purchase_register', label: 'Purchase register', text: 'Every order in the period with value received, GRN numbers and invoice numbers.' },
  { value: 'budget_statement', label: 'Budget statement', text: 'Allocation, committed, spent and available, with monthly spend and order-level detail.' },
  { value: 'stock_valuation', label: 'Stock valuation', text: 'Value of stock on hand by category, with subtotals and a grand total.' },
  { value: 'exceptions', label: 'Exceptions', text: 'Budget overrides, cancelled and rejected orders, damaged receipts and invoice discrepancies.' },
];

export const ReportsPage: React.FC = () => {
  const { activeLabId, activeLab, labs } = useLab();
  const { error: toastError } = useToast();
  const navigate = useNavigate();
  const [type, setType] = useState('stock_ledger');
  const [scope, setScope] = useState<string>(typeof activeLabId === 'number' ? String(activeLabId) : 'all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const params = () => {
    const search = new URLSearchParams({ report_type: type });
    if (scope !== 'all') search.set('lab_id', scope);
    if (from) search.set('from', from);
    if (to) search.set('to', to);
    return search;
  };

  const generate = () => {
    if (from && to && to < from) {
      setError('The end date must be on or after the start date.');
      return;
    }
    setError(null);
    navigate(`/reports/preview?${params().toString()}`);
  };

  const downloadCsv = async () => {
    if (from && to && to < from) {
      setError('The end date must be on or after the start date.');
      return;
    }
    setError(null);
    try {
      await downloadFile(`/api/reports/csv?${params().toString()}`, `${type}.csv`);
    } catch (err) {
      setError(errorMessage(err, 'The CSV could not be downloaded.'));
    }
  };

  const chosen = REPORTS.find((r) => r.value === type)!;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500">Documents for audit and review. Each one is numbered and recorded when generated.</p>
      </div>

      <div className="space-y-5 rounded-lg border border-slate-200 bg-white p-6">
        <ErrorBanner message={error} />
        <Field label="Report" htmlFor="rep-type" required>
          <select id="rep-type" className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
            {REPORTS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="-mt-3 flex items-start gap-2 text-sm text-slate-600">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> {chosen.text}
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Laboratory" htmlFor="rep-lab" hint={activeLab ? undefined : 'Choose one lab, or all labs you can see.'}>
            <select id="rep-lab" className={inputClass} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">All my laboratories</option>
              {labs.map((lab) => (
                <option key={lab.id} value={lab.id}>
                  {lab.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From" htmlFor="rep-from" hint="Blank uses the budget period.">
            <input id="rep-from" type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="rep-to" hint="Blank uses today.">
            <input id="rep-to" type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
          <button type="button" className={buttonSecondary} onClick={downloadCsv}>
            <Download className="h-4 w-4" /> Download CSV
          </button>
          <button type="button" className={buttonPrimary} onClick={generate}>
            Generate report
          </button>
        </div>
      </div>
    </div>
  );
};
