import React from 'react';
import { Skeleton } from './Skeleton.tsx';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  emptyTitle: string;
  emptyText?: string;
  emptyAction?: React.ReactNode;
  onRowClick?: (row: T) => void;
  footer?: React.ReactNode;
  caption?: string;
}

// Reusable table: skeleton rows while loading, a helpful empty state, and horizontal scrolling on small screens.
export function DataTable<T>({ columns, rows, rowKey, loading, emptyTitle, emptyText, emptyAction, onRowClick, footer, caption }: DataTableProps<T>) {
  const alignClass = (align?: string) => (align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left');

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-slate-600">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((col) => (
                <th key={col.key} scope="col" className={`px-4 py-3 whitespace-nowrap ${alignClass(col.align)} ${col.headerClassName ?? ''}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <tr key={`skeleton-${index}`}>
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3">
                      <Skeleton className="h-4 w-full max-w-[160px]" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <p className="font-medium text-slate-700">{emptyTitle}</p>
                  {emptyText && <p className="mt-1 text-slate-500">{emptyText}</p>}
                  {emptyAction && <div className="mt-4">{emptyAction}</div>}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`hover:bg-slate-50 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={`px-4 py-3 align-middle ${alignClass(col.align)} ${col.className ?? ''}`}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer && <div className="border-t border-slate-200 px-4 py-3 text-sm text-slate-500">{footer}</div>}
    </div>
  );
}
