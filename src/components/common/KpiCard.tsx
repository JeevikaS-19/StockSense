import React from 'react';
import { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon?: LucideIcon;
  variant?: 'default' | 'amber' | 'rose';
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  subtext,
  icon: Icon,
  variant = 'default',
}) => {
  const valueColors = {
    default: 'text-slate-900',
    amber: 'text-amber-600',
    rose: 'text-rose-600',
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
      <div className="flex items-center justify-between text-slate-500 mb-2">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</span>
        {Icon && <Icon className="w-4 h-4 text-slate-400" />}
      </div>
      <div>
        <div className={`text-2xl font-bold tracking-tight font-mono tabular-nums ${valueColors[variant]}`}>
          {value}
        </div>
        {subtext && <p className="text-xs text-slate-500 mt-1">{subtext}</p>}
      </div>
    </div>
  );
};
