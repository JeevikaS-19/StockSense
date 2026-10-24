import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { api } from '../../api/client.ts';
import { AppNotification } from '../../types/index.ts';
import { dateTime } from '../../lib/format.ts';
import { useAuth } from '../../context/AuthContext.tsx';

// The bell. Polls every 60 seconds and refreshes when opened. Admins also see the count of open restock requests.
export const NotificationsMenu: React.FC = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [openRequests, setOpenRequests] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await api.notifications.list();
      setItems(res.notifications);
      setUnread(res.unread_count);
      setOpenRequests(res.open_restock_requests);
    } catch {
      /* the bell stays quiet if notifications cannot load; the rest of the app is unaffected */
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load, user?.id]);

  const markAll = async () => {
    await api.notifications.readAll().catch(() => {});
    load();
  };

  const count = unread + (user?.role === 'admin' ? openRequests : 0);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) load();
        }}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        aria-label={`Notifications, ${count} unread`}
        aria-expanded={open}
      >
        <Bell className="h-4.5 w-4.5" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-50 mt-1 w-80 rounded-lg border border-slate-200 bg-white shadow-md">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <p className="text-sm font-medium text-slate-900">Notifications</p>
              {unread > 0 && (
                <button type="button" onClick={markAll} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
                  Mark all as read
                </button>
              )}
            </div>
            {user?.role === 'admin' && openRequests > 0 && (
              <Link to="/requests" onClick={() => setOpen(false)} className="block border-b border-slate-100 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                {openRequests} open restock request{openRequests === 1 ? '' : 's'}
              </Link>
            )}
            <div className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-500">You are all caught up.</p>
              ) : (
                items.map((item) => (
                  <Link
                    key={item.id}
                    to={item.link || '/'}
                    onClick={() => {
                      setOpen(false);
                      if (!item.is_read) api.notifications.read(item.id).then(load).catch(() => {});
                    }}
                    className={`block border-b border-slate-100 px-4 py-3 last:border-0 hover:bg-slate-50 ${item.is_read ? '' : 'bg-indigo-50/40'}`}
                  >
                    <p className="text-sm font-medium text-slate-900">{item.title}</p>
                    {item.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{item.body}</p>}
                    <p className="mt-1 text-xs text-slate-400">
                      {item.lab_code ? `${item.lab_code} · ` : ''}
                      {dateTime(item.created_at)}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
