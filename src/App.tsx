import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { LabProvider } from './context/LabContext.tsx';
import { ToastProvider } from './components/common/Toast.tsx';
import { AppLayout } from './components/layout/AppLayout.tsx';

import { LoginPage } from './pages/LoginPage.tsx';
import { SignupPage } from './pages/SignupPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { ProductsPage } from './pages/ProductsPage.tsx';
import { ReorderPage } from './pages/ReorderPage.tsx';
import { StockMovementPage } from './pages/StockMovementPage.tsx';
import { TransactionsPage } from './pages/TransactionsPage.tsx';
import { SuppliersPage } from './pages/SuppliersPage.tsx';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage.tsx';
import { PurchaseOrderFormPage } from './pages/PurchaseOrderFormPage.tsx';
import { PurchaseOrderDetailPage } from './pages/PurchaseOrderDetailPage.tsx';
import { PurchaseOrderPrintPage } from './pages/PurchaseOrderPrintPage.tsx';
import { ReceiptPage } from './pages/ReceiptPage.tsx';
import { SupplierPortalPage } from './pages/SupplierPortalPage.tsx';
import { BudgetPage } from './pages/BudgetPage.tsx';
import { RequestsPage } from './pages/RequestsPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';
import { ReportPreviewPage } from './pages/ReportPreviewPage.tsx';
import { AuditLogPage } from './pages/AuditLogPage.tsx';
import { LabsPage } from './pages/LabsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { LandingPage } from './pages/LandingPage.tsx';

// The home page is the landing page for signed-out visitors and the app shell for signed-in users.
const HomeRoute: React.FC = () => {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-8 text-sm text-slate-500">Loading…</p>;
  return user ? <AppLayout /> : <LandingPage />;
};

// Administrator-only routes. Staff who type the URL are sent back to the dashboard.
const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
};

// Print and public pages render without the app shell. Signed-out users are sent to log in.
const SignedIn: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-8 text-sm text-slate-500">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <LabProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/supplier/po/:token" element={<SupplierPortalPage />} />
              <Route path="/purchase-orders/:id/print" element={<SignedIn><PurchaseOrderPrintPage /></SignedIn>} />
              <Route path="/reports/preview" element={<SignedIn><ReportPreviewPage /></SignedIn>} />

              <Route path="/" element={<HomeRoute />}>
                <Route index element={<DashboardPage />} />
                <Route path="products" element={<ProductsPage />} />
                <Route path="reorder" element={<ReorderPage />} />
                <Route path="stock" element={<StockMovementPage />} />
                <Route path="transactions" element={<TransactionsPage />} />
                <Route path="suppliers" element={<SuppliersPage />} />
                <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
                <Route path="purchase-orders/new" element={<PurchaseOrderFormPage />} />
                <Route path="purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
                <Route path="purchase-orders/:id/edit" element={<PurchaseOrderFormPage />} />
                <Route path="receipts/:id" element={<ReceiptPage />} />
                <Route path="budget" element={<BudgetPage />} />
                <Route path="requests" element={<RequestsPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="labs" element={<AdminRoute><LabsPage /></AdminRoute>} />
                <Route path="audit" element={<AdminRoute><AuditLogPage /></AdminRoute>} />
                <Route path="settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </LabProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
