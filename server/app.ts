import express, { type ErrorRequestHandler, type Express } from 'express';
import multer from 'multer';
import { databaseMode } from './db.ts';
import { env } from './env.ts';
import { HttpError } from './errors.ts';
import { authRouter } from './routes/auth.routes.ts';
import { labsRouter } from './routes/labs.routes.ts';
import { productsRouter } from './routes/products.routes.ts';
import { stockRouter } from './routes/stock.routes.ts';
import { transactionsRouter } from './routes/transactions.routes.ts';
import { suppliersRouter } from './routes/suppliers.routes.ts';
import { dashboardRouter } from './routes/dashboard.routes.ts';
import { budgetsRouter } from './routes/budgets.routes.ts';
import { purchaseOrdersRouter, receiptsRouter, invoicesRouter } from './routes/purchaseOrders.routes.ts';
import { reorderRouter } from './routes/reorder.routes.ts';
import { notificationsRouter } from './routes/notifications.routes.ts';
import { requestsRouter } from './routes/requests.routes.ts';
import { auditRouter } from './routes/audit.routes.ts';
import { reportsRouter } from './routes/reports.routes.ts';
import { settingsRouter } from './routes/settings.routes.ts';
import { publicRouter } from './routes/public.routes.ts';
import { adminRouter } from './routes/admin.routes.ts';
import { aiRouter } from './routes/ai.routes.ts';
import { runAutomationForAllLabs } from './services/automation.ts';

// Builds the Express app. `mountFrontend` runs after the API routes and before the error handler,
// so the dev server or static files can be added without bypassing error responses.
export async function createApp(mountFrontend?: (app: Express) => void | Promise<void>): Promise<Express> {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      database_mode: databaseMode(),
      database_connected: databaseMode() === 'postgres',
      database_url_configured: Boolean(env.databaseUrl),
      ai_mode: env.aiMock ? 'mock' : env.geminiApiKey ? 'gemini' : 'manual',
      email_configured: Boolean(env.resendApiKey),
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/labs', labsRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/stock', stockRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/budgets', budgetsRouter);
  app.use('/api/purchase-orders', purchaseOrdersRouter);
  app.use('/api/receipts', receiptsRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/reorder', reorderRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/requests', requestsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/ai', aiRouter);

  // Scheduled reorder and automation run, called by Vercel Cron. Vercel sends CRON_SECRET as a bearer token.
  // In production the endpoint refuses to run unless the secret is configured.
  app.get('/api/cron', async (req, res, next) => {
    try {
      const secret = process.env.CRON_SECRET;
      const allowed = secret ? req.headers.authorization === `Bearer ${secret}` : !env.isProduction;
      if (!allowed) throw new HttpError(401, 'UNAUTHORIZED', 'Invalid or missing cron secret.');
      res.json({ labs: await runAutomationForAllLabs() });
    } catch (err) {
      next(err);
    }
  });

  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `Endpoint ${req.method} ${req.path} does not exist.` } });
  });

  if (mountFrontend) await mountFrontend(app);

  const handler: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.details } });
      return;
    }
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      res.status(status).json({ error: { code: err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR', message: err.code === 'LIMIT_FILE_SIZE' ? 'The file must be 5 MB or smaller.' : err.message } });
      return;
    }
    // Postgres rejects malformed ids (for example /api/labs/abc) with these codes; that is a client error.
    if (err && typeof err === 'object' && ['22P02', '22003'].includes((err as { code?: string }).code ?? '')) {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'One of the values in the request is not valid.' } });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON.' } });
      return;
    }
    console.error('[StockSense Server Error]', req.method, req.path, err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server. Please try again.' } });
  };
  app.use(handler);

  return app;
}
