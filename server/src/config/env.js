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
  trustProxy: toInt(process.env.TRUST_PROXY, 1),
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
  // Public base URL used to build absolute links (e.g. invitation emails).
  appUrl: process.env.APP_URL || '',
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
  // Outbound email (SMTP). When SMTP_HOST/SMTP_FROM are unset, email is
  // disabled and invitation links are delivered via the API response only.
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: toInt(process.env.SMTP_PORT, 587),
  smtpSecure: process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || '',
  // Temporary credentials (Super Admin "Generate Temporary Credentials").
  // How long generated temporary passwords remain valid (hours) before the
  // Super Admin must generate new ones.
  tempCredentialTtlHours: toInt(process.env.TEMP_CREDENTIAL_TTL_HOURS, 24),
};

export function validateEnv(config = env) {
  const problems = [];
  if (!config.jwtSecret || config.jwtSecret === 'change-me-to-a-long-random-secret') {
    problems.push(
      'JWT_SECRET is missing or set to the placeholder value. Set a strong secret in .env (openssl rand -hex 48).'
    );
  }

  // Production-only secret hygiene. These are hard failures in production
  // (boot() refuses to start) but intentionally only warnings elsewhere so
  // local development and tests remain frictionless.
  if (config.isProduction) {
    if (config.seedAdminPassword === 'ChangeMe123!') {
      problems.push(
        'SEED_ADMIN_PASSWORD is still the default placeholder. Set a strong unique super-admin password in production.'
      );
    }
    if (config.paymentSecretKey && !config.paymentWebhookSecret) {
      problems.push(
        'PAYMENT_SECRET_KEY is configured but PAYMENT_WEBHOOK_SECRET is missing. Inbound payment webhooks would be rejected (fail-closed) and subscriptions could never be confirmed.'
      );
    }
  }

  return problems;
}
