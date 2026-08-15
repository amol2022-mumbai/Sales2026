// ============================================================================
// SaaS Operations controller (Phase 16) — Super Admin only. Provides the
// cross-tenant operations control center: an operations overview (KPIs across
// tenants, subscriptions, payments, plans, usage, health and security), a
// per-tenant detail view aggregating plan/license/subscription/users/usage and
// recent activity, and derived alerts (expiring/expired licenses, failed or
// overdue payments, near-limit tenants, suspended tenants and security events).
// All metrics are computed from real database state; nothing is fabricated.
// ============================================================================

import { getDb } from '../db/connection.js';
import { notFound } from '../lib/httpError.js';
import { ok, paginated } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { CORE_MODULES } from '../config/modules.js';
import { resolveLicenseState, lifecycleFromTenant, EXPIRING_SOON_DAYS } from '../services/licenseService.js';
import { subscriptionInvoiceBalance, isSubscriptionOverdue } from '../services/subscriptionService.js';
import {
  getCompanyBillingSummary,
  listCompanyInvoices,
  listCompanyPayments,
} from '../services/billingService.js';
import { companyToJson, licenseToJson, planToJson } from './adminController.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysAgo(days) {
  return addDays(today(), -days);
}

const SECURITY_ACTIONS = [
  'auth.login_failed',
  'auth.accept_invite_failed',
  'tenant.suspend',
  'tenant.deactivate',
  'user.reset_password',
  'role.permissions_update',
  'auth.change_password',
];

const FAILED_PAYMENT_EVENTS = ['invoice.payment_failed', 'payment_intent.payment_failed'];

/**
 * Load all companies, licenses and plans once and resolve each company's
 * derived license + lifecycle state. Returns { companies, byCompany } where
 * byCompany maps company id -> { company, license, plan, resolved, lifecycle }.
 */
function loadTenantStates(db) {
  const companies = db.prepare('SELECT * FROM companies ORDER BY id').all();
  const licenseByCompany = new Map(
    db.prepare('SELECT * FROM licenses').all().map((l) => [l.company_id, l])
  );
  const planById = new Map(db.prepare('SELECT * FROM plans').all().map((p) => [p.id, p]));

  const byCompany = new Map();
  for (const company of companies) {
    const license = licenseByCompany.get(company.id) || null;
    const resolved = resolveLicenseState(license, planById.get(license?.plan_id) ?? null);
    byCompany.set(company.id, {
      company,
      license,
      plan: resolved.plan,
      resolved,
      lifecycle: lifecycleFromTenant(company, resolved),
    });
  }
  return { companies, byCompany };
}

// ---------------------------------------------------------------------------
// Operations overview
// ---------------------------------------------------------------------------
export const operationsOverview = asyncHandler(async (req, res) => {
  const db = getDb();
  const { companies, byCompany } = loadTenantStates(db);

  const tenants = { total: companies.length, active: 0, trial: 0, pastDue: 0, suspended: 0, expiring: 0, expired: 0, cancelled: 0, deactivated: 0, pending: 0 };
  const licenses = { total: 0, active: 0, trial: 0, pastDue: 0, expired: 0, suspended: 0, cancelled: 0, expiringSoon: 0 };
  let mrr = 0;
  let monthlyPlans = 0;
  let annualPlans = 0;

  for (const { company, license, plan, resolved, lifecycle } of byCompany.values()) {
    tenants[lifecycle] = (tenants[lifecycle] || 0) + 1;
    if (license) {
      licenses.total += 1;
      const stored = license.status;
      if (stored === 'active') licenses.active += 1;
      else if (stored === 'trial') licenses.trial += 1;
      else if (stored === 'past_due') licenses.pastDue += 1;
      else if (stored === 'expired') licenses.expired += 1;
      else if (stored === 'suspended') licenses.suspended += 1;
      else if (stored === 'cancelled') licenses.cancelled += 1;

      if (resolved.status === 'expiring') licenses.expiringSoon += 1;
      if (resolved.status === 'expired' && stored !== 'expired') licenses.expired += 1;

      if (resolved.status === 'active' || resolved.status === 'trial' || resolved.status === 'expiring') {
        const cycle = license.billing_cycle;
        const price = cycle === 'annual' && Number(plan?.price_annual) > 0 ? Number(plan.price_annual) : Number(plan?.price_monthly) || 0;
        mrr += cycle === 'annual' ? round2(price / 12) : price;
        if (cycle === 'annual') annualPlans += 1;
        else monthlyPlans += 1;
      }
    }
  }
  mrr = round2(mrr);

  // Users.
  const totalUsers = db.prepare("SELECT COUNT(*) AS c FROM users WHERE status != 'inactive'").get().c;
  const activeUsers = db.prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'active'").get().c;

  // Plans.
  const totalPlans = db.prepare('SELECT COUNT(*) AS c FROM plans').get().c;
  const activePlans = db.prepare('SELECT COUNT(*) AS c FROM plans WHERE is_active = 1').get().c;

  // Subscription invoices & payments (real amounts, derived balances).
  const invoices = db.prepare("SELECT * FROM subscription_invoices WHERE status != 'Void'").all();
  const paidTotal = round2(
    db
      .prepare("SELECT COALESCE(SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END), 0) AS v FROM subscription_payments WHERE deleted_at IS NULL")
      .get().v
  );
  const billedTotal = round2(invoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0));
  const outstanding = Math.max(0, round2(billedTotal - paidTotal));

  const payments = { paid: 0, partial: 0, unpaid: 0, overdue: 0 };
  for (const inv of invoices) {
    const balance = subscriptionInvoiceBalance(db, inv);
    if (balance <= 0) payments.paid += 1;
    else if (balance < (Number(inv.amount) || 0)) payments.partial += 1;
    else payments.unpaid += 1;
    if (isSubscriptionOverdue(inv, balance)) payments.overdue += 1;
  }
  const openInvoices = payments.partial + payments.unpaid;
  const failedPayments = db
    .prepare(
      `SELECT COUNT(*) AS c FROM subscription_events WHERE event_type IN ('invoice.payment_failed','payment_intent.payment_failed')`
    )
    .get().c;

  // New tenants in the last 30 days.
  const newTenants30d = db.prepare('SELECT COUNT(*) AS c FROM companies WHERE created_at >= ?').get(daysAgo(30)).c;

  // Trial conversion: paying (active) tenants vs current trials.
  const trials = licenses.trial;
  let converted = 0;
  for (const { company, license, resolved } of byCompany.values()) {
    if (!license) continue;
    if (resolved.status !== 'active' && resolved.status !== 'expiring') continue;
    const paid = db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM subscription_payments WHERE company_id = ? AND type = \'payment\' AND deleted_at IS NULL').get(company.id).v;
    if (Number(paid) > 0) converted += 1;
  }
  const trialPool = trials + converted;
  const conversionRate = trialPool > 0 ? round2((converted / trialPool) * 100) : null;

  // Health.
  const failedWebhookEvents = db.prepare("SELECT COUNT(*) AS c FROM subscription_events WHERE status = 'failed'").get().c;
  const pendingWebhookEvents = db.prepare("SELECT COUNT(*) AS c FROM subscription_events WHERE status = 'received'").get().c;
  const pendingInvitations = db.prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'pending'").get().c;

  // Security & activity (audit trail).
  const secPh = SECURITY_ACTIONS.map(() => '?').join(',');
  const events24h = db
    .prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE action IN (${secPh}) AND created_at >= ?`)
    .get(...SECURITY_ACTIONS, daysAgo(1)).c;
  const events7d = db
    .prepare(`SELECT COUNT(*) AS c FROM audit_logs WHERE action IN (${secPh}) AND created_at >= ?`)
    .get(...SECURITY_ACTIONS, daysAgo(7)).c;

  const securityRecent = db
    .prepare(
      `SELECT a.*, u.name AS user_name, u.email AS user_email
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.action IN (${secPh})
       ORDER BY a.created_at DESC, a.id DESC LIMIT 10`
    )
    .all(...SECURITY_ACTIONS)
    .map(auditRowToJson);

  const activity = db
    .prepare(
      `SELECT a.*, u.name AS user_name, u.email AS user_email, c.name AS company_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN companies c ON c.id = a.company_id
       ORDER BY a.created_at DESC, a.id DESC LIMIT 15`
    )
    .all()
    .map((a) => ({ ...auditRowToJson(a), companyName: a.company_name || null }));

  return ok(res, {
    totals: {
      tenants,
      newTenants30d,
      users: { total: totalUsers, active: activeUsers },
      licenses,
      plans: { total: totalPlans, active: activePlans, monthly: monthlyPlans, annual: annualPlans },
      subscription: {
        mrr,
        arr: round2(mrr * 12),
        collected: paidTotal,
        outstanding,
        openInvoices,
        overdueInvoices: payments.overdue,
        failedPayments,
      },
      payments,
      trialConversion: { trials, converted, rate: conversionRate },
    },
    health: {
      failedWebhookEvents,
      pendingWebhookEvents,
      failedPayments,
      pendingInvitations,
    },
    security: { events24h, events7d, recent: securityRecent },
    activity,
  });
});

function auditRowToJson(a) {
  return {
    id: a.id,
    companyId: a.company_id,
    userId: a.user_id,
    userName: a.user_name || null,
    userEmail: a.user_email || null,
    action: a.action,
    entityType: a.entity_type,
    entityId: a.entity_id,
    ipAddress: a.ip_address,
    userAgent: a.user_agent,
    metadata: a.metadata ? safeJson(a.metadata) : null,
    createdAt: a.created_at,
  };
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tenant overview (detailed)
// ---------------------------------------------------------------------------
export const getClientOverview = asyncHandler(async (req, res) => {
  const db = getDb();
  const companyId = req.params.id;

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  if (!company) throw notFound('Client not found');

  const { byCompany } = loadTenantStates(db);
  const state = byCompany.get(company.id);
  const { license, plan, resolved, lifecycle } = state;

  const userCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE company_id = ? AND status != 'inactive'").get(company.id).c;
  const users = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.status, u.last_login_at, r.key AS roleKey, r.name AS roleName
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.company_id = ? ORDER BY u.id`
    )
    .all(company.id);

  const leadCount = db.prepare('SELECT COUNT(*) AS c FROM leads WHERE company_id = ? AND deleted_at IS NULL').get(company.id).c;
  const customerCount = db.prepare('SELECT COUNT(*) AS c FROM customers WHERE company_id = ? AND deleted_at IS NULL').get(company.id).c;
  const openOpportunities = db.prepare("SELECT COUNT(*) AS c FROM opportunities WHERE company_id = ? AND stage != 'Won' AND stage != 'Lost' AND deleted_at IS NULL").get(company.id).c;
  const wonRevenue = round2(
    db.prepare("SELECT COALESCE(SUM(deal_value), 0) AS v FROM opportunities WHERE company_id = ? AND stage = 'Won' AND deleted_at IS NULL").get(company.id).v
  );
  const collected = round2(
    db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM payments WHERE company_id = ? AND deleted_at IS NULL').get(company.id).v
  );
  const receivablesOutstanding = round2(
    db.prepare(
      `SELECT COALESCE(SUM(i.amount), 0) - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.deleted_at IS NULL), 0) AS v
       FROM invoices i WHERE i.company_id = ? AND i.deleted_at IS NULL`
    ).get(company.id).v
  );

  const billing = getCompanyBillingSummary(db, company);
  const invoices = listCompanyInvoices(db, company.id).slice(0, 10);
  const payments = listCompanyPayments(db, company.id).slice(0, 10);

  const activity = db
    .prepare(
      `SELECT a.*, u.name AS user_name, u.email AS user_email
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.company_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 15`
    )
    .all(company.id)
    .map(auditRowToJson);

  return ok(res, {
    ...companyToJson(company),
    lifecycle,
    licenseStatus: resolved.status,
    license: licenseToJson(license, company.id),
    plan: plan ? planToJson(plan) : null,
    userLimit: resolved.userLimit,
    userCount,
    users,
    enabledFeatures: resolved.moduleKeys == null ? null : [...resolved.moduleKeys, ...CORE_MODULES].sort(),
    storageLimitMb: resolved.storageLimitMb,
    exportEnabled: resolved.exportEnabled !== false,
    apiEnabled: resolved.apiEnabled !== false,
    billing: {
      billingCycle: billing.billingCycle,
      autoRenew: billing.autoRenew,
      priceMonthly: billing.priceMonthly,
      priceAnnual: billing.priceAnnual,
      currentPrice: billing.currentPrice,
      billed: billing.billed,
      paid: billing.paid,
      outstanding: billing.outstanding,
      openInvoices: billing.openInvoices,
      failedPayments: billing.failedPayments,
      renewalDate: billing.renewalDate,
    },
    usage: {
      leadCount,
      customerCount,
      openOpportunities,
      wonRevenue,
      collected,
      receivablesOutstanding,
    },
    invoices,
    payments,
    activity,
  });
});

// ---------------------------------------------------------------------------
// Alerts (derived from live tenant/billing/security state)
// ---------------------------------------------------------------------------
export const listAlerts = asyncHandler(async (req, res) => {
  const db = getDb();
  const { page, pageSize, type, severity } = req.query;

  const { byCompany } = loadTenantStates(db);
  const ref = today();
  const horizon = addDays(ref, EXPIRING_SOON_DAYS);

  const alerts = [];

  for (const { company, license, plan, resolved, lifecycle } of byCompany.values()) {
    const companyId = company.id;
    const companyName = company.name;

    // License expiring soon (active/trial within the horizon).
    if ((resolved.status === 'expiring' || resolved.status === 'active' || resolved.status === 'trial') && license?.expires_at && license.expires_at >= ref && license.expires_at <= horizon) {
      alerts.push({
        id: `license_expiring:${companyId}`,
        type: 'license_expiring',
        severity: 'warning',
        title: `License expiring soon — ${companyName}`,
        message: `${plan?.name || 'Plan'} license expires ${license.expires_at}.`,
        companyId,
        companyName,
        data: { expiresAt: license.expires_at, planKey: plan?.key || null },
      });
    }

    // Expired license / subscription.
    if (resolved.status === 'expired') {
      alerts.push({
        id: `license_expired:${companyId}`,
        type: 'license_expired',
        severity: 'critical',
        title: `License expired — ${companyName}`,
        message: `The ${plan?.name || 'plan'} license for ${companyName} has expired.`,
        companyId,
        companyName,
        data: { expiresAt: license?.expires_at || null, planKey: plan?.key || null },
      });

      const billed = db.prepare("SELECT COUNT(*) AS c FROM subscription_invoices WHERE company_id = ? AND status != 'Void'").get(companyId).c;
      if (billed > 0) {
        alerts.push({
          id: `subscription_expired:${companyId}`,
          type: 'subscription_expired',
          severity: 'critical',
          title: `Paying subscription expired — ${companyName}`,
          message: `${companyName} has ${billed} billed invoice(s) and an expired license.`,
          companyId,
          companyName,
          data: { billedInvoices: billed },
        });
      }
    }

    // Overdue subscription invoices.
    const overdueInvoices = db
      .prepare("SELECT * FROM subscription_invoices WHERE company_id = ? AND status != 'Void'")
      .all(companyId)
      .filter((inv) => isSubscriptionOverdue(inv, subscriptionInvoiceBalance(db, inv)));
    if (overdueInvoices.length > 0) {
      const owed = round2(overdueInvoices.reduce((sum, i) => sum + subscriptionInvoiceBalance(db, i), 0));
      alerts.push({
        id: `payment_overdue:${companyId}`,
        type: 'payment_overdue',
        severity: 'critical',
        title: `Overdue payment — ${companyName}`,
        message: `${overdueInvoices.length} invoice(s) overdue totaling ${owed}.`,
        companyId,
        companyName,
        data: { overdueInvoices: overdueInvoices.length, owed },
      });
    }

    // Failed payments.
    const failed = db
      .prepare(
        `SELECT COUNT(*) AS c FROM subscription_events WHERE company_id = ? AND event_type IN ('invoice.payment_failed','payment_intent.payment_failed')`
      )
      .get(companyId).c;
    if (failed > 0) {
      alerts.push({
        id: `payment_failed:${companyId}`,
        type: 'payment_failed',
        severity: 'warning',
        title: `Failed payment — ${companyName}`,
        message: `${failed} payment failure(s) recorded for ${companyName}.`,
        companyId,
        companyName,
        data: { failedPayments: failed },
      });
    }

    // Near user-limit.
    const userLimit = resolved.userLimit;
    if (userLimit > 0) {
      const userCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE company_id = ? AND status != 'inactive'").get(companyId).c;
      const pct = (userCount / userLimit) * 100;
      if (pct >= 90) {
        alerts.push({
          id: `user_near_limit:${companyId}`,
          type: 'user_near_limit',
          severity: 'warning',
          title: `Near user limit — ${companyName}`,
          message: `${userCount}/${userLimit} seats used (${Math.round(pct)}%).`,
          companyId,
          companyName,
          data: { userCount, userLimit, pct: round2(pct) },
        });
      }
    }

    // Suspended tenants.
    if (lifecycle === 'suspended') {
      alerts.push({
        id: `tenant_suspended:${companyId}`,
        type: 'tenant_suspended',
        severity: 'warning',
        title: `Tenant suspended — ${companyName}`,
        message: `${companyName} is suspended and its users cannot sign in.`,
        companyId,
        companyName,
        data: { companyStatus: company.status, licenseStatus: resolved.status },
      });
    }

    // Past-due tenants (grace period after a failed payment).
    if (lifecycle === 'past_due') {
      alerts.push({
        id: `tenant_past_due:${companyId}`,
        type: 'tenant_past_due',
        severity: 'warning',
        title: `Payment past due — ${companyName}`,
        message: `${companyName} has an overdue subscription payment and is in its grace period.`,
        companyId,
        companyName,
        data: { licenseStatus: resolved.status, pastDueAt: resolved.pastDueAt },
      });
    }
  }

  // Security events (recent sensitive audit actions).
  const secPh = SECURITY_ACTIONS.map(() => '?').join(',');
  const securityRows = db
    .prepare(
      `SELECT a.*, u.name AS user_name, u.email AS user_email, c.name AS company_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN companies c ON c.id = a.company_id
       WHERE a.action IN (${secPh}) AND a.created_at >= ?
       ORDER BY a.created_at DESC, a.id DESC LIMIT 50`
    )
    .all(...SECURITY_ACTIONS, daysAgo(7));
  for (const ev of securityRows) {
    const email = ev.metadata ? (safeJson(ev.metadata)?.email ?? null) : null;
    alerts.push({
      id: `security:${ev.id}`,
      type: 'security',
      severity: 'warning',
      title: `Security event — ${ev.action}`,
      message: `${ev.action}${email ? ` for ${email}` : ''} (${ev.company_name || 'platform'}).`,
      companyId: ev.company_id,
      companyName: ev.company_name || null,
      data: { action: ev.action, email: email || ev.user_email || null, createdAt: ev.created_at },
    });
  }

  // Sort: critical first, then warning, then info; stable by id.
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.id.localeCompare(b.id));

  let filtered = alerts;
  if (type) filtered = filtered.filter((a) => a.type === type);
  if (severity) filtered = filtered.filter((a) => a.severity === severity);

  const total = filtered.length;
  const offset = (page - 1) * pageSize;
  const pageItems = filtered.slice(offset, offset + pageSize);

  return paginated(res, pageItems, { page, pageSize, total });
});
