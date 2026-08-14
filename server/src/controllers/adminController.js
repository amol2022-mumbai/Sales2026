import { getDb } from '../db/connection.js';
import crypto from 'node:crypto';
import { notFound, conflict, badRequest } from '../lib/httpError.js';
import { ok, created, paginated } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { hashPassword } from '../lib/password.js';
import { MODULES, CORE_MODULES } from '../config/modules.js';
import { resolveLicense, getUserCount, loadTenant, assertUserLimit, lifecycleFromTenant, resolveTenantLifecycle } from '../services/licenseService.js';
import { aiStatus, testAiConnection } from '../services/aiService.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'company'
  );
}

function parseJsonModules(value) {
  if (value == null) return null;
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function planToJson(p) {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    userLimit: p.user_limit,
    modules: parseJsonModules(p.modules),
    priceMonthly: p.price_monthly,
    priceAnnual: p.price_annual,
    sortOrder: p.sort_order,
    isActive: Boolean(p.is_active),
    storageLimitMb: p.storage_limit_mb,
    exportEnabled: Boolean(p.export_enabled),
    apiEnabled: Boolean(p.api_enabled),
    licenseDurationDays: p.license_duration_days,
    trialDays: p.trial_days,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function companyToJson(c) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    email: c.email,
    phone: c.phone,
    website: c.website,
    address: c.address,
    city: c.city,
    state: c.state,
    country: c.country,
    industry: c.industry,
    postalCode: c.postal_code,
    logoUrl: c.logo_url,
    faviconUrl: c.favicon_url,
    brandColor: c.brand_color,
    domain: c.domain,
    currency: c.currency,
    timezone: c.timezone,
    status: c.status,
    onboardedAt: c.onboarded_at || null,
    activatedAt: c.activated_at || null,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

function licenseToJson(l, companyId) {
  if (!l) return null;
  return {
    id: l.id,
    companyId: l.company_id ?? companyId,
    planId: l.plan_id,
    status: l.status,
    startsAt: l.starts_at,
    expiresAt: l.expires_at,
    userLimit: l.user_limit,
    modules: parseJsonModules(l.modules),
    storageLimitMb: l.storage_limit_mb ?? null,
    exportEnabled: l.export_enabled == null ? null : Boolean(l.export_enabled),
    apiEnabled: l.api_enabled == null ? null : Boolean(l.api_enabled),
    billingCycle: l.billing_cycle ?? null,
    autoRenew: l.auto_renew == null ? null : Boolean(l.auto_renew),
    createdAt: l.created_at,
    updatedAt: l.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Clients (companies) — Super Admin only.
// ---------------------------------------------------------------------------
export const listClients = asyncHandler(async (req, res) => {
  const db = getDb();
  const { page, pageSize, search, status } = req.query;

  const where = [];
  const params = [];
  if (search) {
    where.push('(name LIKE ? OR email LIKE ? OR domain LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM companies ${whereSql}`).get(...params).c;
  const rows = db
    .prepare(`SELECT * FROM companies ${whereSql} ORDER BY id LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);

  const clients = rows.map((c) => {
    const license = db.prepare('SELECT * FROM licenses WHERE company_id = ?').get(c.id);
    const userCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE company_id = ? AND status != 'inactive'").get(c.id).c;
    const resolved = resolveLicense(db, c.id);
    const { status: licenseStatus, expiresAt, plan, moduleKeys, storageLimitMb, exportEnabled, apiEnabled } = resolved;
    return {
      ...companyToJson(c),
      license: licenseToJson(license, c.id),
      licenseStatus,
      lifecycleStatus: lifecycleFromTenant(c, resolved),
      onboardedAt: c.onboarded_at || null,
      activatedAt: c.activated_at || null,
      licenseExpiresAt: expiresAt,
      planName: plan?.name || null,
      planKey: plan?.key || null,
      userCount,
      enabledFeatures: moduleKeys == null ? null : [...moduleKeys, ...CORE_MODULES].sort(),
      storageLimitMb,
      exportEnabled: exportEnabled !== false,
      apiEnabled: apiEnabled !== false,
    };
  });

  return paginated(res, clients, { page, pageSize, total });
});

export const getClient = asyncHandler(async (req, res) => {
  const db = getDb();
  const resolved = resolveTenantLifecycle(db, req.params.id);
  if (!resolved) throw notFound('Client not found');
  const { company, license, plan, lifecycle, moduleKeys, userLimit } = resolved;
  const userCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE company_id = ? AND status != 'inactive'").get(company.id).c;
  const users = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.status, u.last_login_at, r.key AS roleKey, r.name AS roleName
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.company_id = ? ORDER BY u.id`
    )
    .all(company.id);
  return ok(res, {
    ...companyToJson(company),
    license: licenseToJson(license, company.id),
    plan: plan ? { id: plan.id, key: plan.key, name: plan.name } : null,
    licenseStatus: resolved.status,
    lifecycleStatus: lifecycle,
    userLimit,
    enabledFeatures: moduleKeys,
    userCount,
    users,
  });
});

const CLIENT_FIELDS = [
  'name',
  'email',
  'phone',
  'website',
  'address',
  'city',
  'state',
  'country',
  'industry',
  'postalCode',
  'currency',
  'timezone',
  'logoUrl',
  'faviconUrl',
  'brandColor',
  'domain',
  'status',
];

function applyCompanyFields(db, id, body) {
  const sets = [];
  const values = [];
  for (const field of CLIENT_FIELDS) {
    if (body[field] !== undefined) {
      const column = {
        postalCode: 'postal_code',
        logoUrl: 'logo_url',
        faviconUrl: 'favicon_url',
        brandColor: 'brand_color',
      }[field] || field;
      sets.push(`${column} = ?`);
      values.push(body[field]);
    }
  }
  if (body.name !== undefined) {
    sets.push('slug = ?');
    values.push(slugify(body.name));
  }
  return { sets, values };
}

export const createClient = asyncHandler(async (req, res) => {
  const db = getDb();
  const name = req.body.name;
  const slug = slugify(name);

  if (req.body.domain) {
    const existing = db.prepare('SELECT id FROM companies WHERE domain = ?').get(req.body.domain);
    if (existing) throw conflict('A client with this domain already exists');
  }

  const result = db.prepare(
    `INSERT INTO companies (name, slug, email, phone, website, address, city, state, country, industry, postal_code, currency, timezone, logo_url, favicon_url, brand_color, domain, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name,
    slug,
    req.body.email ?? null,
    req.body.phone ?? null,
    req.body.website ?? null,
    req.body.address ?? null,
    req.body.city ?? null,
    req.body.state ?? null,
    req.body.country ?? null,
    req.body.industry ?? null,
    req.body.postalCode ?? null,
    req.body.currency ?? 'USD',
    req.body.timezone ?? 'UTC',
    req.body.logoUrl ?? null,
    req.body.faviconUrl ?? null,
    req.body.brandColor ?? null,
    req.body.domain ?? null,
    req.body.status ?? 'active'
  );

  const id = Number(result.lastInsertRowid);
  req.audit?.('client.create', { entityType: 'company', entityId: id, metadata: { name } });

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
  return created(res, companyToJson(company));
});

export const updateClient = asyncHandler(async (req, res) => {
  const db = getDb();
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) throw notFound('Client not found');

  if (req.body.domain && req.body.domain !== company.domain) {
    const existing = db.prepare('SELECT id FROM companies WHERE domain = ? AND id != ?').get(req.body.domain, company.id);
    if (existing) throw conflict('A client with this domain already exists');
  }

  const { sets, values } = applyCompanyFields(db, company.id, req.body);
  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(company.id);
    db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  req.audit?.('client.update', { entityType: 'company', entityId: company.id });

  const updated = db.prepare('SELECT * FROM companies WHERE id = ?').get(company.id);
  return ok(res, companyToJson(updated));
});

// ---------------------------------------------------------------------------
// Tenant lifecycle actions (Super Admin only). These transition the company
// level status that the auth middleware enforces (suspended/inactive) and are
// audited separately from generic client edits.
// ---------------------------------------------------------------------------
export const activateTenant = asyncHandler(async (req, res) => {
  const db = getDb();
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) throw notFound('Client not found');

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE companies SET status = 'active', activated_at = COALESCE(activated_at, ?), updated_at = ? WHERE id = ?`
  ).run(now, now, company.id);

  // Un-suspend the license when the tenant was suspended at the license level.
  db.prepare("UPDATE licenses SET status = 'active', updated_at = ? WHERE company_id = ? AND status = 'suspended'").run(now, company.id);

  req.audit?.('tenant.activate', { entityType: 'company', entityId: company.id });

  const updated = db.prepare('SELECT * FROM companies WHERE id = ?').get(company.id);
  return ok(res, companyToJson(updated));
});

export const suspendTenant = asyncHandler(async (req, res) => {
  const db = getDb();
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) throw notFound('Client not found');

  db.prepare("UPDATE companies SET status = 'suspended', updated_at = ? WHERE id = ?").run(new Date().toISOString(), company.id);
  req.audit?.('tenant.suspend', { entityType: 'company', entityId: company.id });

  const updated = db.prepare('SELECT * FROM companies WHERE id = ?').get(company.id);
  return ok(res, companyToJson(updated));
});

export const deactivateTenant = asyncHandler(async (req, res) => {
  const db = getDb();
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) throw notFound('Client not found');

  db.prepare("UPDATE companies SET status = 'inactive', updated_at = ? WHERE id = ?").run(new Date().toISOString(), company.id);
  req.audit?.('tenant.deactivate', { entityType: 'company', entityId: company.id });

  const updated = db.prepare('SELECT * FROM companies WHERE id = ?').get(company.id);
  return ok(res, companyToJson(updated));
});

// ---------------------------------------------------------------------------
// Composite onboarding (Super Admin only). Creates a company, optionally
// provisions its license (plan + trial/active status) and creates the Company
// Admin as a pending user with a one-time invitation token — atomically, so the
// full "Create Company → Select Plan → Set Trial/License → Create Company
// Admin → Send Invitation" flow never leaves a half-created tenant.
// ---------------------------------------------------------------------------
export const onboardTenant = asyncHandler(async (req, res) => {
  const db = getDb();
  const name = req.body.name;
  const slug = slugify(name);

  if (req.body.domain) {
    const existing = db.prepare('SELECT id FROM companies WHERE domain = ?').get(req.body.domain);
    if (existing) throw conflict('A client with this domain already exists');
  }

  let plan = null;
  if (req.body.planId != null) {
    plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.body.planId);
    if (!plan) throw notFound('Plan not found');
  }

  const adminRole = db.prepare("SELECT id, key FROM roles WHERE key = 'business_owner'").get();
  if (!adminRole) throw badRequest('business_owner role missing');
  if (req.body.adminEmail) {
    const existingUser = db.prepare('SELECT id, company_id FROM users WHERE email = ?').get(req.body.adminEmail);
    if (existingUser) throw conflict('This email already belongs to another user');
  }

  const invitationToken = crypto.randomBytes(32).toString('hex');
  const invitationExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const now = new Date().toISOString();

  db.exec('BEGIN');
  let companyId;
  let licenseId = null;
  let adminUserId = null;
  try {
    const companyResult = db
      .prepare(
        `INSERT INTO companies (name, slug, email, phone, website, address, city, state, country, industry, postal_code, currency, timezone, logo_url, favicon_url, brand_color, domain, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        name,
        slug,
        req.body.email ?? null,
        req.body.phone ?? null,
        req.body.website ?? null,
        req.body.address ?? null,
        req.body.city ?? null,
        req.body.state ?? null,
        req.body.country ?? null,
        req.body.industry ?? null,
        req.body.postalCode ?? null,
        req.body.currency ?? 'USD',
        req.body.timezone ?? 'UTC',
        req.body.logoUrl ?? null,
        req.body.faviconUrl ?? null,
        req.body.brandColor ?? null,
        req.body.domain ?? null,
        req.body.status ?? 'active'
      );
    companyId = Number(companyResult.lastInsertRowid);

    if (plan) {
      const status = req.body.licenseStatus ?? 'active';
      const startsAt = req.body.startsAt ?? new Date().toISOString().slice(0, 10);
      let expiresAt = req.body.expiresAt ?? null;
      if (req.body.expiresAt === undefined) {
        const base = startsAt;
        if (status === 'trial' && plan.trial_days > 0) expiresAt = addDays(base, plan.trial_days);
        else if (status === 'active' && plan.license_duration_days > 0) expiresAt = addDays(base, plan.license_duration_days);
      }
      const modulesJson = req.body.modules !== undefined ? (req.body.modules != null ? JSON.stringify(req.body.modules) : null) : null;
      const licenseResult = db
        .prepare(
          `INSERT INTO licenses (company_id, plan_id, status, starts_at, expires_at, user_limit, modules, storage_limit_mb, export_enabled, api_enabled, billing_cycle, auto_renew, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          companyId,
          plan.id,
          status,
          startsAt,
          expiresAt,
          req.body.userLimit ?? null,
          modulesJson,
          req.body.storageLimitMb ?? null,
          req.body.exportEnabled == null ? null : req.body.exportEnabled ? 1 : 0,
          req.body.apiEnabled == null ? null : req.body.apiEnabled ? 1 : 0,
          req.body.billingCycle ?? null,
          req.body.autoRenew == null ? 1 : req.body.autoRenew ? 1 : 0,
          req.user.id
        );
      licenseId = Number(licenseResult.lastInsertRowid);
    }

    if (req.body.adminName && req.body.adminEmail) {
      const adminResult = db
        .prepare(
          `INSERT INTO users (company_id, role_id, name, email, password_hash, status, invitation_token, invitation_expires_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
        )
        .run(
          companyId,
          adminRole.id,
          req.body.adminName,
          req.body.adminEmail,
          hashPassword(crypto.randomBytes(16).toString('hex')),
          invitationToken,
          invitationExpiresAt
        );
      adminUserId = Number(adminResult.lastInsertRowid);
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  req.audit?.('tenant.create', { entityType: 'company', entityId: companyId, metadata: { name } });
  if (licenseId) req.audit?.('license.upsert', { entityType: 'company', entityId: companyId, metadata: { planId: plan.id, status: req.body.licenseStatus ?? 'active' } });
  if (adminUserId) req.audit?.('tenant.invite_admin', { entityType: 'user', entityId: adminUserId, metadata: { email: req.body.adminEmail, companyId } });

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  const license = licenseId ? db.prepare('SELECT * FROM licenses WHERE id = ?').get(licenseId) : null;
  return created(res, {
    company: companyToJson(company),
    license: licenseToJson(license, companyId),
    invitation: adminUserId
      ? { invitationToken, userId: adminUserId, email: req.body.adminEmail, status: 'pending' }
      : null,
  });
});

// ---------------------------------------------------------------------------
// Tenant onboarding: invite / re-invite a Company Admin (Super Admin only).
// Creates a `pending` user with a one-time invitation token; the invitee sets
// their own password via POST /api/auth/accept-invite before they can log in.
// ---------------------------------------------------------------------------
export const inviteCompanyAdmin = asyncHandler(async (req, res) => {
  const db = getDb();
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) throw notFound('Client not found');

  const { name, email, roleId } = req.body;
  const role = roleId
    ? db.prepare('SELECT id, key FROM roles WHERE id = ?').get(roleId)
    : db.prepare("SELECT id, key FROM roles WHERE key = 'business_owner'").get();
  if (!role) throw badRequest('Invalid role');

  // Enforce the tenant's user limit when the license imposes one.
  assertUserLimit(loadTenant({ companyId: company.id }), company.id);

  const invitationToken = crypto.randomBytes(32).toString('hex');
  const invitationExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) {
    if (existing.company_id !== company.id) {
      throw conflict('This email already belongs to another client');
    }
    db.prepare(
      `UPDATE users SET name = ?, role_id = ?, status = 'pending', invitation_token = ?, invitation_expires_at = ?, updated_at = ? WHERE id = ?`
    ).run(name, role.id, invitationToken, invitationExpiresAt, new Date().toISOString(), existing.id);

    req.audit?.('tenant.invite_admin', {
      entityType: 'user',
      entityId: existing.id,
      metadata: { email, companyId: company.id, reset: true },
    });

    return ok(res, { invitationToken, userId: existing.id, email, status: 'pending', reset: true });
  }

  const info = db
    .prepare(
      `INSERT INTO users (company_id, role_id, name, email, password_hash, status, invitation_token, invitation_expires_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .run(company.id, role.id, name, email, hashPassword(crypto.randomBytes(16).toString('hex')), invitationToken, invitationExpiresAt);

  req.audit?.('tenant.invite_admin', {
    entityType: 'user',
    entityId: info.lastInsertRowid,
    metadata: { email, companyId: company.id },
  });

  return created(res, { invitationToken, userId: Number(info.lastInsertRowid), email, status: 'pending' });
});

// ---------------------------------------------------------------------------
// Plans — Super Admin only.
// ---------------------------------------------------------------------------
export const listPlans = asyncHandler(async (_req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM plans ORDER BY sort_order, id').all();
  return ok(res, rows.map(planToJson));
});

export const getPlan = asyncHandler(async (req, res) => {
  const db = getDb();
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
  if (!plan) throw notFound('Plan not found');
  return ok(res, planToJson(plan));
});

export const createPlan = asyncHandler(async (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM plans WHERE key = ?').get(req.body.key);
  if (existing) throw conflict('A plan with this key already exists');

  const result = db.prepare(
    `INSERT INTO plans (key, name, description, user_limit, modules, price_monthly, price_annual, sort_order, is_active, storage_limit_mb, export_enabled, api_enabled, license_duration_days, trial_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.body.key,
    req.body.name,
    req.body.description ?? null,
    req.body.userLimit ?? -1,
    req.body.modules != null ? JSON.stringify(req.body.modules) : null,
    req.body.priceMonthly ?? 0,
    req.body.priceAnnual ?? 0,
    req.body.sortOrder ?? 0,
    req.body.isActive ? 1 : 0,
    req.body.storageLimitMb ?? -1,
    req.body.exportEnabled === false ? 0 : 1,
    req.body.apiEnabled ? 1 : 0,
    req.body.licenseDurationDays ?? 0,
    req.body.trialDays ?? 0
  );

  req.audit?.('plan.create', { entityType: 'plan', entityId: Number(result.lastInsertRowid), metadata: { key: req.body.key } });

  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(Number(result.lastInsertRowid));
  return created(res, planToJson(plan));
});

export const updatePlan = asyncHandler(async (req, res) => {
  const db = getDb();
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
  if (!plan) throw notFound('Plan not found');

  const sets = [];
  const values = [];
  const fields = {
    name: 'name',
    description: 'description',
    userLimit: 'user_limit',
    priceMonthly: 'price_monthly',
    priceAnnual: 'price_annual',
    sortOrder: 'sort_order',
    storageLimitMb: 'storage_limit_mb',
    licenseDurationDays: 'license_duration_days',
    trialDays: 'trial_days',
  };
  for (const [input, column] of Object.entries(fields)) {
    if (req.body[input] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(req.body[input]);
    }
  }
  if (req.body.modules !== undefined) {
    sets.push('modules = ?');
    values.push(req.body.modules != null ? JSON.stringify(req.body.modules) : null);
  }
  if (req.body.isActive !== undefined) {
    sets.push('is_active = ?');
    values.push(req.body.isActive ? 1 : 0);
  }
  if (req.body.exportEnabled !== undefined) {
    sets.push('export_enabled = ?');
    values.push(req.body.exportEnabled ? 1 : 0);
  }
  if (req.body.apiEnabled !== undefined) {
    sets.push('api_enabled = ?');
    values.push(req.body.apiEnabled ? 1 : 0);
  }

  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(plan.id);
    db.prepare(`UPDATE plans SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  req.audit?.('plan.update', { entityType: 'plan', entityId: plan.id });

  const updated = db.prepare('SELECT * FROM plans WHERE id = ?').get(plan.id);
  return ok(res, planToJson(updated));
});

// ---------------------------------------------------------------------------
// Licenses — Super Admin only.
// ---------------------------------------------------------------------------
export const listLicenses = asyncHandler(async (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT l.*, c.name AS company_name, p.name AS plan_name
       FROM licenses l
       JOIN companies c ON c.id = l.company_id
       LEFT JOIN plans p ON p.id = l.plan_id
       ORDER BY l.id`
    )
    .all();
  return ok(
    res,
    rows.map((l) => ({ ...licenseToJson(l), companyName: l.company_name, planName: l.plan_name }))
  );
});

export const getLicense = asyncHandler(async (req, res) => {
  const db = getDb();
  const license = db.prepare('SELECT * FROM licenses WHERE company_id = ?').get(req.params.id);
  if (!license) throw notFound('License not found');
  return ok(res, licenseToJson(license));
});

function addDays(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const upsertLicense = asyncHandler(async (req, res) => {
  const db = getDb();
  const companyId = Number(req.params.id);
  const company = db.prepare('SELECT id FROM companies WHERE id = ?').get(companyId);
  if (!company) throw notFound('Client not found');

  let plan = null;
  if (req.body.planId != null) {
    plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.body.planId);
    if (!plan) throw notFound('Plan not found');
  }

  const existing = db.prepare('SELECT id FROM licenses WHERE company_id = ?').get(companyId);
  const modulesJson = req.body.modules !== undefined ? (req.body.modules != null ? JSON.stringify(req.body.modules) : null) : undefined;

  // Derive a default expiry from the plan's trial period / license duration
  // when the caller does not provide one and the license is being provisioned
  // (i.e. there is no existing license yet).
  let expiresAt = req.body.expiresAt ?? null;
  const startsAt = req.body.startsAt ?? existing?.starts_at ?? null;
  if (!existing && req.body.expiresAt === undefined) {
    const status = req.body.status;
    const base = startsAt || new Date().toISOString().slice(0, 10);
    if (status === 'trial' && plan?.trial_days > 0) {
      expiresAt = addDays(base, plan.trial_days);
    } else if (status === 'active' && plan?.license_duration_days > 0) {
      expiresAt = addDays(base, plan.license_duration_days);
    }
  }

  if (existing) {
    const sets = [];
    const values = [];
    if (req.body.planId !== undefined) {
      sets.push('plan_id = ?');
      values.push(req.body.planId);
    }
    if (req.body.status !== undefined) {
      sets.push('status = ?');
      values.push(req.body.status);
    }
    if (req.body.startsAt !== undefined) {
      sets.push('starts_at = ?');
      values.push(req.body.startsAt);
    }
    if (req.body.expiresAt !== undefined) {
      sets.push('expires_at = ?');
      values.push(req.body.expiresAt);
    }
    if (req.body.userLimit !== undefined) {
      sets.push('user_limit = ?');
      values.push(req.body.userLimit);
    }
    if (modulesJson !== undefined) {
      sets.push('modules = ?');
      values.push(modulesJson);
    }
    if (req.body.storageLimitMb !== undefined) {
      sets.push('storage_limit_mb = ?');
      values.push(req.body.storageLimitMb);
    }
    if (req.body.exportEnabled !== undefined) {
      sets.push('export_enabled = ?');
      values.push(req.body.exportEnabled == null ? null : req.body.exportEnabled ? 1 : 0);
    }
    if (req.body.apiEnabled !== undefined) {
      sets.push('api_enabled = ?');
      values.push(req.body.apiEnabled == null ? null : req.body.apiEnabled ? 1 : 0);
    }
    if (req.body.billingCycle !== undefined) {
      sets.push('billing_cycle = ?');
      values.push(req.body.billingCycle);
    }
    if (req.body.autoRenew !== undefined) {
      sets.push('auto_renew = ?');
      values.push(req.body.autoRenew == null ? 1 : req.body.autoRenew ? 1 : 0);
    }
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(existing.id);
    db.prepare(`UPDATE licenses SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  } else {
    db.prepare(
      `INSERT INTO licenses (company_id, plan_id, status, starts_at, expires_at, user_limit, modules, storage_limit_mb, export_enabled, api_enabled, billing_cycle, auto_renew, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      companyId,
      req.body.planId ?? null,
      req.body.status,
      startsAt ?? null,
      expiresAt,
      req.body.userLimit ?? null,
      modulesJson ?? null,
      req.body.storageLimitMb ?? null,
      req.body.exportEnabled == null ? null : req.body.exportEnabled ? 1 : 0,
      req.body.apiEnabled == null ? null : req.body.apiEnabled ? 1 : 0,
      req.body.billingCycle ?? null,
      req.body.autoRenew == null ? 1 : req.body.autoRenew ? 1 : 0,
      req.user.id
    );
  }

  req.audit?.('license.upsert', { entityType: 'company', entityId: companyId });

  const license = db.prepare('SELECT * FROM licenses WHERE company_id = ?').get(companyId);
  return ok(res, licenseToJson(license, companyId));
});

// ---------------------------------------------------------------------------
// Module catalog (for the Super Admin UI).
// ---------------------------------------------------------------------------
export const listModules = asyncHandler(async (_req, res) => {
  return ok(res, {
    modules: MODULES,
    core: CORE_MODULES,
  });
});

// ---------------------------------------------------------------------------
// AI Assistant configuration — Super Admin only. Never exposes API keys.
// ---------------------------------------------------------------------------
export const aiConfigStatus = asyncHandler(async (_req, res) => {
  return ok(res, aiStatus());
});

export const aiConfigTest = asyncHandler(async (_req, res) => {
  const result = await testAiConnection();
  return ok(res, result);
});

// ---------------------------------------------------------------------------
// Platform dashboard — Super Admin only. Cross-tenant analytics computed from
// real data across every company. An optional `companyId` drills into a single
// client.
// ---------------------------------------------------------------------------
function monthsAgo(count) {
  const months = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    months.push({ key, label });
  }
  return months;
}

export const platformDashboard = asyncHandler(async (req, res) => {
  const db = getDb();
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;

  const companies = companyId
    ? db.prepare('SELECT * FROM companies WHERE id = ?').all(companyId)
    : db.prepare('SELECT * FROM companies ORDER BY id').all();

  const totalCompanies = db.prepare('SELECT COUNT(*) AS c FROM companies').get().c;
  const activeCompanies = db.prepare("SELECT COUNT(*) AS c FROM companies WHERE status = 'active'").get().c;
  const inactiveCompanies = db.prepare("SELECT COUNT(*) AS c FROM companies WHERE status = 'inactive'").get().c;
  const suspendedCompanies = db.prepare("SELECT COUNT(*) AS c FROM companies WHERE status = 'suspended'").get().c;

  const totalUsers = db.prepare("SELECT COUNT(*) AS c FROM users WHERE status != 'inactive'").get().c;
  const activeUsers = db.prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'active'").get().c;

  const totalLeads = db.prepare('SELECT COUNT(*) AS c FROM leads WHERE deleted_at IS NULL').get().c;
  const totalCustomers = db.prepare('SELECT COUNT(*) AS c FROM customers WHERE deleted_at IS NULL').get().c;
  const totalRevenue = round2(
    db.prepare("SELECT COALESCE(SUM(deal_value), 0) AS v FROM opportunities WHERE stage = 'Won' AND deleted_at IS NULL").get().v
  );
  const totalCollected = round2(
    db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM payments WHERE deleted_at IS NULL').get().v
  );
  const totalOutstanding = round2(
    db.prepare(
      `SELECT COALESCE(SUM(i.amount), 0) - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.deleted_at IS NULL), 0) AS v
       FROM invoices i WHERE i.deleted_at IS NULL`
    ).get().v
  );

  const totalPlans = db.prepare('SELECT COUNT(*) AS c FROM plans').get().c;
  const activePlans = db.prepare('SELECT COUNT(*) AS c FROM plans WHERE is_active = 1').get().c;
  const totalLicenses = db.prepare('SELECT COUNT(*) AS c FROM licenses').get().c;

  // License lifecycle summary across all tenants.
  const licenseStatusRows = db.prepare('SELECT status, COUNT(*) AS c FROM licenses GROUP BY status').all();
  const licenseByStatus = Object.fromEntries(licenseStatusRows.map((r) => [r.status, r.c]));

  const today = new Date().toISOString().slice(0, 10);
  const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const expiringSoon = db
    .prepare(
      `SELECT COUNT(*) AS c FROM licenses
       WHERE status IN ('active','trial') AND expires_at IS NOT NULL AND expires_at >= ? AND expires_at <= ?`
    )
    .get(today, in30Days).c;

  // Subscription revenue (MRR/ARR) from active & trial licenses' plans.
  const mrrRow = db
    .prepare(
      `SELECT COALESCE(SUM(p.price_monthly), 0) AS v
       FROM licenses l JOIN plans p ON p.id = l.plan_id
       WHERE l.status IN ('active','trial')`
    )
    .get();
  const mrr = round2(mrrRow.v);
  const arr = round2(mrr * 12);

  // Tenant growth: companies & users created per month (last 12 months).
  const growthMonths = monthsAgo(12);
  const companyGrowthRows = db
    .prepare("SELECT strftime('%Y-%m', created_at) AS m, COUNT(*) AS c FROM companies GROUP BY m")
    .all();
  const userGrowthRows = db
    .prepare("SELECT strftime('%Y-%m', created_at) AS m, COUNT(*) AS c FROM users GROUP BY m")
    .all();
  const companyGrowth = new Map(companyGrowthRows.map((r) => [r.m, r.c]));
  const userGrowth = new Map(userGrowthRows.map((r) => [r.m, r.c]));
  const tenantGrowth = growthMonths.map((m) => ({
    month: m.label,
    companies: companyGrowth.get(m.key) || 0,
    users: userGrowth.get(m.key) || 0,
  }));

  // Feature usage: how many tenants have each (non-core) module enabled.
  const enabledModuleSets = new Map(
    companies.map((c) => {
      const { moduleKeys } = resolveLicense(db, c.id);
      return [c.id, moduleKeys == null ? null : new Set([...moduleKeys, ...CORE_MODULES])];
    })
  );
  const featureUsage = MODULES.map((m) => ({
    module: m.key,
    label: m.label,
    companies: companies.filter((c) => {
      const set = enabledModuleSets.get(c.id);
      return set == null || set.has(m.key);
    }).length,
  }));

  const perCompany = companies.map((c) => {
    const userCount = getUserCount(db, c.id);
    const leadCount = db.prepare('SELECT COUNT(*) AS c FROM leads WHERE company_id = ? AND deleted_at IS NULL').get(c.id).c;
    const customerCount = db.prepare('SELECT COUNT(*) AS c FROM customers WHERE company_id = ? AND deleted_at IS NULL').get(c.id).c;
    const wonRevenue = round2(
      db.prepare("SELECT COALESCE(SUM(deal_value), 0) AS v FROM opportunities WHERE company_id = ? AND stage = 'Won' AND deleted_at IS NULL").get(c.id).v
    );
    const collected = round2(
      db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM payments WHERE company_id = ? AND deleted_at IS NULL').get(c.id).v
    );
    const outstanding = round2(
      db.prepare(
        `SELECT COALESCE(SUM(i.amount), 0) - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.deleted_at IS NULL), 0) AS v
         FROM invoices i WHERE i.company_id = ? AND i.deleted_at IS NULL`
      ).get(c.id).v
    );
    const { status: licenseStatus, expiresAt, plan, userLimit } = resolveLicense(db, c.id);
    const userLimitUtilizationPct = userLimit > 0 ? round2((userCount / userLimit) * 100) : null;
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      licenseStatus,
      licenseExpiresAt: expiresAt,
      planKey: plan?.key || null,
      planName: plan?.name || null,
      userLimit,
      userCount,
      userLimitUtilizationPct,
      leadCount,
      customerCount,
      wonRevenue,
      collected,
      outstanding,
    };
  });

  return ok(res, {
    totals: {
      companies: totalCompanies,
      activeCompanies,
      inactiveCompanies,
      suspendedCompanies,
      users: totalUsers,
      activeUsers,
      leads: totalLeads,
      customers: totalCustomers,
      revenue: totalRevenue,
      collected: totalCollected,
      outstanding: totalOutstanding,
      plans: totalPlans,
      activePlans,
      licenses: totalLicenses,
      license: {
        active: licenseByStatus.active || 0,
        trial: licenseByStatus.trial || 0,
        expired: licenseByStatus.expired || 0,
        suspended: licenseByStatus.suspended || 0,
        cancelled: licenseByStatus.cancelled || 0,
        expiringSoon,
      },
      mrr,
      arr,
    },
    tenantGrowth,
    featureUsage,
    companies: perCompany,
  });
});
