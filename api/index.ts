import type { IncomingMessage, ServerResponse } from 'http';
import type { Express } from 'express';
import { createApp } from '../server/app.ts';
import { initDatabase } from '../server/db.ts';
import { runMigrations } from '../db/migrate.ts';

// Vercel entry point: every /api/* request goes through this one function. The Express app and the
// database connection are created once per warm instance. Migrations are idempotent, so running them on
// a cold start is safe.
let ready: Promise<Express> | null = null;

function getApp(): Promise<Express> {
  if (!ready) {
    ready = (async () => {
      await initDatabase();
      await runMigrations();
      return createApp();
    })();
    // A failed start (for example, a database outage) is retried on the next request.
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  return app(req as any, res as any, () => undefined);
}
