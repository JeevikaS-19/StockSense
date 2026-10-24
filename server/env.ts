import dotenv from 'dotenv';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

// Loaded here, before any module reads configuration, so .env values are always visible.
// The test suite sets STOCKSENSE_SKIP_DOTENV so a developer's .env (and its real database) is never loaded.
if (process.env.STOCKSENSE_SKIP_DOTENV !== 'true') dotenv.config();

const PLACEHOLDER_MARKERS = ['MY_APP_URL', 'user:password@host', 'MY_GEMINI_API_KEY'];

function configured(value: string | undefined): string | null {
  if (!value || PLACEHOLDER_MARKERS.some((marker) => value.includes(marker))) return null;
  return value;
}

export const DATA_DIR = process.env.STOCKSENSE_DATA_DIR || path.resolve(process.cwd(), '.data');

export const env = {
  port: Number(process.env.PORT) || 3000,
  isProduction: process.env.NODE_ENV === 'production',
  databaseUrl: configured(process.env.DATABASE_URL),
  aiMock: process.env.AI_MOCK === 'true',
  geminiApiKey: configured(process.env.GEMINI_API_KEY),
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  appUrl: (configured(process.env.APP_URL) || `http://localhost:${Number(process.env.PORT) || 3000}`).replace(/\/$/, ''),
  resendApiKey: configured(process.env.RESEND_API_KEY),
  emailFrom: process.env.EMAIL_FROM || 'StockSense <onboarding@resend.dev>',
  automationEnabled: process.env.AUTOMATION_ENABLED !== 'false',
};

let cachedJwtSecret: string | null = null;

// Resolved lazily (on first use) so that .env is always loaded first.
// Production refuses to start without an explicit secret; development persists a generated one.
export function jwtSecret(): string {
  if (cachedJwtSecret) return cachedJwtSecret;
  if (process.env.JWT_SECRET) {
    cachedJwtSecret = process.env.JWT_SECRET;
    return cachedJwtSecret;
  }
  if (env.isProduction) {
    throw new Error('JWT_SECRET must be set when NODE_ENV=production.');
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, 'jwt-secret');
  if (fs.existsSync(file)) {
    cachedJwtSecret = fs.readFileSync(file, 'utf-8').trim();
  } else {
    cachedJwtSecret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(file, cachedJwtSecret, 'utf-8');
  }
  return cachedJwtSecret;
}
