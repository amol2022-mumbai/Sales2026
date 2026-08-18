import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

/**
 * Outbound email service. Sending is enabled only when both SMTP_HOST and
 * SMTP_FROM are configured; otherwise invitation emails are skipped and the
 * accept-invite link is returned so the admin can share it manually.
 */

let cachedTransport = null;

export function isMailEnabled() {
  return Boolean(env.smtpHost && env.smtpFrom);
}

/**
 * Absolute accept-invite URL for a one-time invitation token. Falls back to a
 * relative path when APP_URL is not configured.
 *
 * The token is carried in the URL fragment (`#token=...`), never the query
 * string. Fragments are not sent to the server, so the token can never be
 * written to access logs (morgan `combined` logs the request line, including
 * any query string) or leak via the `Referer` header.
 */
export function buildInviteUrl(token) {
  const base = (env.appUrl || '').replace(/\/+$/, '');
  return `${base}/accept-invite#token=${encodeURIComponent(token)}`;
}

function getTransport() {
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
      // Keep invitation requests snappy: fail fast if SMTP is unreachable.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return cachedTransport;
}

/**
 * Send a company-admin invitation email. Accepts an optional `transport` for
 * tests (and future custom transports); when a transport is supplied it is
 * used even if SMTP is not otherwise configured. Never throws: transport
 * failures are returned so callers can decide how to surface them.
 * @returns {Promise<{ sent: boolean, link: string, error?: string, messageId?: string }>}
 */
export async function sendInviteEmail({ to, companyName, adminName, token, transport }) {
  const link = buildInviteUrl(token);

  const mailer = transport || (isMailEnabled() ? getTransport() : null);
  if (!mailer) {
    return { sent: false, link };
  }

  const subject = `Welcome to ${env.appName} — set up your ${companyName || 'workspace'} account`;
  const greet = adminName ? `Hi ${adminName},` : 'Hi there,';
  const workspace = companyName || 'your workspace';

  const text = [
    greet,
    '',
    `An administrator account has been created for you on ${workspace}.`,
    'Click the link below to set your password and get started. This link expires in 7 days.',
    '',
    link,
    '',
    `— ${env.appName}`,
  ].join('\n');

  const html = [
    `<p>${greet}</p>`,
    `<p>An administrator account has been created for you on <strong>${workspace}</strong>.</p>`,
    '<p>Click the button below to set your password and get started. This link expires in 7 days.</p>',
    `<p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:6px;">Set up your account</a></p>`,
    `<p style="color:#64748b;font-size:12px;">If the button does not work, copy and paste this link into your browser:<br/>${link}</p>`,
    `<p>— ${env.appName}</p>`,
  ].join('\n');

  try {
    const info = await mailer.sendMail({ from: env.smtpFrom, to, subject, text, html });
    return { sent: true, link, messageId: info?.messageId || null };
  } catch (err) {
    return { sent: false, link, error: err.message };
  }
}
