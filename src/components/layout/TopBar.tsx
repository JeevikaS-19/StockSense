import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, Building2, LogOut, Menu, Check, Hand } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useLab } from '../../context/LabContext.tsx';
import { NotificationsMenu } from './NotificationsMenu.tsx';
import { RestockRequestModal } from './RestockRequestModal.tsx';

interface TopBarProps {
  onToggleSidebar: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onToggleSidebar }) => {
  const { user, logout } = useAuth();
  const { activeLabId, activeLab, labs, setActiveLabId } = useLab();
  const navigate = useNavigate();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  const labName = activeLabId === 'all' ? 'All laboratories' : activeLab ? activeLab.name : labs.length === 0 ? 'No laboratory assigned' : 'Choose a laboratory';

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onToggleSidebar} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Open navigation menu">
          <Menu className="h-5 w-5" />
        </button>

        <div className="relative min-w-0">
          <button
            type="button"
            onClick={() => setSwitcherOpen((open) => !open)}
            className="flex max-w-[60vw] items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-left hover:bg-slate-50 md:max-w-none"
            aria-haspopup="listbox"
            aria-expanded={switcherOpen}
          >
            <Building2 className="h-4 w-4 shrink-0 text-slate-500" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-slate-900">{labName}</span>
              {activeLab && <span className="block truncate text-xs text-slate-500">{activeLab.department} · {activeLab.code}</span>}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </button>

          {switcherOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSwitcherOpen(false)} aria-hidden="true" />
              <div className="absolute left-0 z-50 mt-1 w-80 rounded-lg border border-slate-200 bg-white py-1 shadow-md" role="listbox">
                <p className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Switch laboratory</p>
                {user?.role === 'admin' && (
                  <button
                    type="button"
                    role="option"
                    aria-selected={activeLabId === 'all'}
                    onClick={() => {
                      setActiveLabId('all');
                      setSwitcherOpen(false);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span>
                      <span className="block font-medium text-slate-900">All laboratories</span>
                      <span className="block text-xs text-slate-500">Consolidated view</span>
                    </span>
                    {activeLabId === 'all' && <Check className="h-4 w-4 text-indigo-600" />}
                  </button>
                )}
                <div className="max-h-64 overflow-y-auto">
                  {labs.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">No laboratories are assigned to you yet.</p>}
                  {labs.map((lab) => (
                    <button
                      key={lab.id}
                      type="button"
                      role="option"
                      aria-selected={activeLabId === lab.id}
                      onClick={() => {
                        setActiveLabId(lab.id);
                        setSwitcherOpen(false);
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900">{lab.name}</span>
                        <span className="block truncate text-xs text-slate-500">{lab.department} · {lab.location}</span>
                      </span>
                      {activeLabId === lab.id && <Check className="h-4 w-4 shrink-0 text-indigo-600" />}
                    </button>
                  ))}
                </div>
                {user?.role === 'admin' && (
                  <div className="border-t border-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSwitcherOpen(false);
                        navigate('/labs');
                      }}
                      className="w-full rounded-md px-3 py-1.5 text-left text-sm font-medium text-indigo-600 hover:bg-indigo-50"
                    >
                      Create or manage laboratories
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {user?.role === 'staff' && activeLab && (
          <button
            type="button"
            onClick={() => setContactOpen(true)}
            className="hidden items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:inline-flex"
          >
            <Hand className="h-3.5 w-3.5 text-indigo-600" />
            Contact admin
          </button>
        )}
        <NotificationsMenu />

        <div className="relative">
          <button type="button" onClick={() => setUserOpen((open) => !open)} className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-slate-100" aria-haspopup="menu" aria-expanded={userOpen}>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">{user?.name?.[0]?.toUpperCase() ?? 'U'}</span>
            <span className="hidden text-left md:block">
              <span className="block text-sm font-medium leading-tight text-slate-900">{user?.name}</span>
              <span className="block text-xs capitalize text-slate-500">{user?.role}</span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </button>
          {userOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserOpen(false)} aria-hidden="true" />
              <div className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-md" role="menu">
                <div className="border-b border-slate-100 px-4 py-2">
                  <p className="text-sm font-medium text-slate-900">{user?.name}</p>
                  <p className="truncate text-xs text-slate-500">{user?.email}</p>
                </div>
                <Link to="/settings" hidden={user?.role !== 'admin'} onClick={() => setUserOpen(false)} className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50" role="menuitem">
                  Settings
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setUserOpen(false);
                    logout();
                    navigate('/login');
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {contactOpen && activeLab && <RestockRequestModal labId={activeLab.id} onClose={() => setContactOpen(false)} />}
    </header>
  );
};
