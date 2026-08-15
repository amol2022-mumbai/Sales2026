// ============================================================================
// Payment provider abstraction (Phase 14). Secrets are read server-side only
// and are never exposed to the frontend or config endpoints. When no provider
// secret is configured the service runs in "mock" mode: checkout returns
// non-sensitive client parameters and the only way to apply a payment is via a
// *server-verified* signed webhook (or the mock completion endpoint that
// simulates that webhook server-side). The frontend can never set payment
// state directly.
// ============================================================================

import crypto from 'node:crypto';
import { env } from '../config/env.js';

export function paymentProvider() {
  return env.paymentProvider;
}

/**
 * True when checkout should run in mock mode: only when no real provider
 * secret is configured (so the flow stays usable offline). A real secret
 * always wins, so a stray `PAYMENT_MOCK=1` can never reopen the mock payment
 * path in a production deployment that has a live provider.
 */
export function isMockMode() {
  return !env.paymentSecretKey;
}

/**
 * The webhook verification secret. Fails closed: when a live provider is
 * configured (i.e. not mock mode) but no webhook secret is set, verification
 * must reject every inbound event rather than fall back to a well-known
 * constant that an attacker could sign with.
 */
export function webhookSecret() {
  if (env.paymentWebhookSecret) return env.paymentWebhookSecret;
  if (isMockMode()) return 'mock-webhook-secret';
  return null;
}

/**
 * HMAC-SHA256 signature of a raw webhook body. Used both to verify inbound
 * webhooks and (in mock mode) to construct signed payloads for tests.
 */
export function signWebhookBody(rawBody, secret = webhookSecret()) {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * Timing-safe verification of a webhook signature against the raw body.
 */
export function verifyWebhookSignature(rawBody, signature, secret = webhookSecret()) {
  if (!secret || !signature || typeof signature !== 'string') return false;
  const expected = signWebhookBody(rawBody, secret);
  const sigBuf = Buffer.from(signature.trim(), 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Build a Stripe-style signature header (`t=timestamp,v1=hex`) from a raw
 * body. The timestamp is included to detect replay/expiry; verification
 * recomputes the digest over `timestamp.rawBody`.
 */
export function signWebhookHeader(rawBody, secret = webhookSecret()) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

function extractV1(header) {
  if (!header || typeof header !== 'string') return null;
  const parts = header.split(',');
  const v1 = parts.find((p) => p.trim().startsWith('v1='));
  if (!v1) return null;
  return v1.trim().slice(3);
}

// Maximum allowed age of a signed webhook before it is treated as a replay.
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

/**
 * Verify a Stripe-style `t=,v1=` signature header. The embedded timestamp must
 * be within a small tolerance window so a captured request cannot be replayed
 * later. Accepts a simple hex digest as a fallback (used by the mock provider).
 */
export function verifyWebhookHeader(rawBody, header, secret = webhookSecret()) {
  if (!secret || !header || typeof header !== 'string') return false;
  if (header.includes('v1=')) {
    const tMatch = header.match(/(?:^|,)\s*t=(\d+)/);
    const t = tMatch ? tMatch[1] : null;
    const v1 = extractV1(header);
    if (!t || !v1) return false;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(t)) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) return false;
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
    const a = Buffer.from(v1, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  return verifyWebhookSignature(rawBody, header, secret);
}

/**
 * Create a checkout session for a subscription invoice. Returns only
 * non-sensitive client parameters; no secrets are ever included. In mock mode
 * a fake client secret is returned that can only be "completed" server-side.
 * @param {object} params
 * @param {number} params.invoiceId subscription_invoices.id
 * @param {number} params.amount amount in the plan currency
 * @param {string} params.currency 3-letter currency code
 * @param {string} params.description invoice description
 * @param {number} params.companyId
 */
export function createCheckoutSession({ invoiceId, amount, currency, description, companyId }) {
  const provider = paymentProvider();
  const mock = isMockMode();
  const sessionId = `${provider}_${Date.now()}_${invoiceId}`;

  return {
    provider,
    mock,
    mode: env.paymentMode,
    sessionId,
    clientSecret: mock ? `mock_secret_${invoiceId}_${companyId}` : null,
    checkoutUrl: mock ? null : null, // real providers supply a hosted URL here
    invoiceId,
    companyId,
    amount: Math.round(amount * 100) / 100,
    currency,
    description,
  };
}

/**
 * Mock payment intent id (used only in mock mode to construct provider events).
 */
export function mockPaymentIntentId(invoiceId) {
  return `pi_mock_${invoiceId}`;
}
