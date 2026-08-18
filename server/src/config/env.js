import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Server package root (server/), containing src/, tests/ and scripts/.
export const serverPackageRoot = path.resolve(__dirname, '..', '..');
// Repository root (contains server/ and web/). The canonical production .env
// lives here, next to the root package.json.
export const repoRoot = path.resolve(serverPackageRoot, '..');

// Resolve the .env file deterministically from the source tree, never from the
// process working directory. npm workspace scripts run with cwd set to the
// workspace (server/), so a cwd-relative lookup would load server/.env
// (development defaults) instead of the production .env at the repository root.
// DOTENV_CONFIG_PATH remains available as an explicit override for operators.
export function resolveDotenvPath() {
  if (process.env.DOTENV_CONFIG_PATH) return path.resolve(process.env.DOTENV_CONFIG_PATH);
  return path.join(repoRoot, '.env');
}

dotenv.config({ path: resolveDotenvPath() });

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
      : path.resolve(serverPackageRoot, process.env.DB_PATH || './data/crm.db'),
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

// Values that are clearly not a real production configuration. These are the
// documented examples/defaults from .env.production.example plus the code
// fallbacks in `env`. Angle-bracket tokens like <REPLACE_WITH_...> are the
// project's placeholder convention and are always rejected.
const PLACEHOLDER_VALUES = new Set([
  'changeme123!',
  'changeme',
  'change-me',
  'change-me-to-a-long-random-secret',
  'your-api-key-here',
  'your-secret-here',
  'replace_me',
  'replaceme',
  'placeholder',
  'acme corp',
  'acme',
]);

function isPlaceholder(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  if (/^<[^>]+>$/.test(v)) return true;
  if (PLACEHOLDER_VALUES.has(v.toLowerCase())) return true;
  // Example/placeholder email addresses and hostnames.
  if (/@(example\.com|example\.org|example\.net)$/i.test(v)) return true;
  if (/^(https?:\/\/)?(example\.com|example\.org|example\.net)(\/.*)?$/i.test(v)) return true;
  return false;
}

export function validateEnv(config = env) {
  const problems = [];

  // JWT_SECRET is always required (hard failure in production, warning
  // elsewhere) and must never be a placeholder.
  if (!config.jwtSecret || isPlaceholder(config.jwtSecret)) {
    problems.push(
      'JWT_SECRET is missing or set to a placeholder value. Set a strong secret in .env (openssl rand -hex 48).'
    );
  }

  // Production-only secret hygiene. These are hard failures in production
  // (boot() refuses to start) but intentionally only warnings elsewhere so
  // local development and tests remain frictionless. Every message names the
  // offending variable without printing its value.
  if (config.isProduction) {
    if (isPlaceholder(config.seedAdminPassword)) {
      problems.push(
        'SEED_ADMIN_PASSWORD is set to a placeholder or default value. Set a strong unique super-admin password in production.'
      );
    }
    if (isPlaceholder(config.seedAdminEmail)) {
      problems.push(
        'SEED_ADMIN_EMAIL is set to a placeholder value. Set the real super-admin login email in production.'
      );
    }
    if (isPlaceholder(config.seedCompanyName)) {
      problems.push(
        'SEED_COMPANY_NAME is set to a placeholder value. Set the real company name in production.'
      );
    }
    if (config.paymentSecretKey && isPlaceholder(config.paymentSecretKey)) {
      problems.push(
        'PAYMENT_SECRET_KEY is set to a placeholder value. Provide a real payment secret or leave it empty for mock checkout.'
      );
    }
    if (config.paymentSecretKey && !config.paymentWebhookSecret) {
      problems.push(
        'PAYMENT_SECRET_KEY is configured but PAYMENT_WEBHOOK_SECRET is missing. Inbound payment webhooks would be rejected (fail-closed) and subscriptions could never be confirmed.'
      );
    } else if (config.paymentWebhookSecret && isPlaceholder(config.paymentWebhookSecret)) {
      problems.push(
        'PAYMENT_WEBHOOK_SECRET is set to a placeholder value. Provide a real webhook signing secret.'
      );
    }
    if (config.smtpPass && isPlaceholder(config.smtpPass)) {
      problems.push(
        'SMTP_PASS is set to a placeholder value. Provide a real SMTP password or leave SMTP unconfigured.'
      );
    }
    if (config.aiApiKey && isPlaceholder(config.aiApiKey)) {
      problems.push(
        'AI_API_KEY is set to a placeholder value. Provide a real API key or leave it empty to use the offline assistant.'
      );
    }
  }

  return problems;
}
