import express, { type Express } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { env, jwtSecret } from './server/env.ts';
import { initDatabase } from './server/db.ts';
import { runMigrations } from './db/migrate.ts';
import { createApp } from './server/app.ts';
import { startAutomation } from './server/services/automation.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Development serves the React app through Vite (with hot reload). Production serves the built dist/ folder.
async function mountFrontend(app: Express): Promise<void> {
  if (!env.isProduction) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: __dirname,
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.use(async (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      try {
        const template = await vite.transformIndexHtml(req.originalUrl, fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8'));
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });
    return;
  }

  const distPath = path.resolve(__dirname, 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(distPath, 'index.html'));
  });
}

async function main() {
  // Fails fast in production when JWT_SECRET is missing, instead of on the first sign-in.
  jwtSecret();
  await initDatabase();
  const applied = await runMigrations();
  if (applied.length > 0) console.log(`[StockSense DB] Applied migrations: ${applied.join(', ')}`);

  const app = await createApp(mountFrontend);
  app.listen(env.port, '0.0.0.0', () => {
    console.log(`[StockSense Server] Running on http://0.0.0.0:${env.port}`);
  });
  startAutomation();
}

main().catch((err) => {
  console.error('[StockSense Server] Failed to start:', err);
  process.exit(1);
});
