import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function splitList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: toInt(process.env.PORT, 4000),
  apiBaseUrl: process.env.API_BASE_URL || `http://localhost:${toInt(process.env.PORT, 4000)}`,
  corsOrigins: splitList(process.env.CORS_ORIGINS),
  dbPath:
    process.env.DB_PATH === ':memory:'
      ? ':memory:'
      : path.resolve(serverRoot, process.env.DB_PATH || './data/crm.db'),
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  seedAdminName: process.env.SEED_ADMIN_NAME || 'Super Admin',
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!',
  seedCompanyName: process.env.SEED_COMPANY_NAME || 'Acme Corp',
  // Platform-level white-label defaults (used as a fallback when no tenant
  // branding is configured). Per-client branding is stored in `companies`.
  appName: process.env.APP_NAME || 'SalesDesk CRM',
  appBrandColor: process.env.APP_BRAND_COLOR || '#4f46e5',
  appFaviconUrl: process.env.APP_FAVICON_URL || '',
  appLogoUrl: process.env.APP_LOGO_URL || '',
  // AI Assistant (Phase 11). Provider/keys are read server-side only and are
  // never exposed to the frontend. When unset, the assistant falls back to a
  // deterministic, rule-based answer computed from real tenant data.
  aiProvider: process.env.AI_PROVIDER || '',
  aiApiKey: process.env.AI_API_KEY || '',
  aiModel: process.env.AI_MODEL || '',
  aiBaseUrl: process.env.AI_BASE_URL || '',
  aiTimeoutMs: toInt(process.env.AI_TIMEOUT_MS, 30000),
  // Online payments (Phase 14). Secrets are read server-side only and are never
  // exposed to the frontend or the config endpoints. When no secret key is
  // configured, checkout runs in a mock mode so the flow stays usable offline;
  // payment state is still only ever applied from a verified webhook.
  paymentProvider: process.env.PAYMENT_PROVIDER || 'stripe',
  paymentMode: process.env.PAYMENT_MODE || 'test',
  paymentSecretKey: process.env.PAYMENT_SECRET_KEY || '',
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
  paymentMock: process.env.PAYMENT_MOCK === '1' || process.env.PAYMENT_MOCK === 'true',
};

export function validateEnv() {
  const problems = [];
  if (!env.jwtSecret || env.jwtSecret === 'change-me-to-a-long-random-secret') {
    problems.push(
      'JWT_SECRET is missing or set to the placeholder value. Set a strong secret in .env (openssl rand -hex 48).'
    );
  }
  return problems;
}
