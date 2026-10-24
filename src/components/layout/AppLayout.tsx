import React, { useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.tsx';
import { useLab } from '../../context/LabContext.tsx';
import { Sidebar } from './Sidebar.tsx';
import { TopBar } from './TopBar.tsx';
import { ErrorBanner } from '../common/Field.tsx';
import { PageLoading } from '../common/Skeleton.tsx';

export const AppLayout: React.FC = () => {
  const { user, loading, authError, retry } = useAuth();
  const { labsReady, labsError, refreshLabs } = useLab();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500" role="status">Loading StockSense…</p>
      </div>
    );
  }
  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md">
          <ErrorBanner message={authError} onRetry={retry} />
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 antialiased">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onToggleSidebar={() => setIsSidebarOpen((open) => !open)} />
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6 lg:p-8">
          {labsError ? (
            <ErrorBanner message={labsError} onRetry={refreshLabs} />
          ) : !labsReady ? (
            <PageLoading label="Loading laboratories" />
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
};
