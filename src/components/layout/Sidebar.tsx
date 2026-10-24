import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.tsx';
import {
  LayoutDashboard,
  Boxes,
  RefreshCcw,
  ArrowLeftRight,
  History,
  ClipboardList,
  Wallet,
  Truck,
  Hand,
  FileBarChart,
  ShieldCheck,
  ScrollText,
  Settings,
  Package2,
  X,
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const WORKSPACE = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/products', label: 'Products', icon: Boxes },
  { to: '/reorder', label: 'Reorder', icon: RefreshCcw },
  { to: '/stock', label: 'Stock in / out', icon: ArrowLeftRight },
  { to: '/transactions', label: 'Transactions', icon: History },
  { to: '/purchase-orders', label: 'Purchase orders', icon: ClipboardList },
  { to: '/budget', label: 'Budget', icon: Wallet },
  { to: '/suppliers', label: 'Suppliers', icon: Truck },
  { to: '/requests', label: 'Restock requests', icon: Hand },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
];

const ADMIN = [
  { to: '/labs', label: 'Labs & team', icon: ShieldCheck },
  { to: '/audit', label: 'Audit log', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const items = user?.role === 'admin' ? [...WORKSPACE, ...ADMIN] : WORKSPACE;

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-40 bg-slate-900/40 md:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        className={`fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-slate-800 bg-slate-900 text-slate-300 transition-transform duration-200 md:sticky md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-slate-800 px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Package2 className="h-4 w-4" />
            </div>
            <div>
              <span className="block text-sm font-semibold text-white">StockSense</span>
              <span className="block text-[11px] text-slate-400">Lab inventory</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-white md:hidden" aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4" aria-label="Main">
          <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">
            {user?.role === 'admin' ? 'Administration' : 'Workspace'}
          </p>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-3">
          <div className="flex items-center gap-2.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-200">
              {user?.name?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">{user?.name}</p>
              <p className="text-xs capitalize text-slate-400">{user?.role}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
