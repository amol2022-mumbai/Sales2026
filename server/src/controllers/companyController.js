import { getDb } from '../db/connection.js';
import { notFound, forbidden } from '../lib/httpError.js';
import { ok, paginated } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';

function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'company'
  );
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

export const listCompanies = asyncHandler(async (req, res) => {
  const db = getDb();
  const { page, pageSize } = req.query;

  if (req.user.isSuperAdmin) {
    const total = db.prepare('SELECT COUNT(*) AS c FROM companies WHERE deleted_at IS NULL').get().c;
    const rows = db
      .prepare('SELECT * FROM companies WHERE deleted_at IS NULL ORDER BY id LIMIT ? OFFSET ?')
      .all(pageSize, (page - 1) * pageSize);
    return paginated(res, rows.map(companyToJson), { page, pageSize, total });
  }

  if (!req.user.companyId) throw notFound('No company associated with your account');
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.user.companyId);
  if (!company) throw notFound('Company not found');
  return ok(res, [companyToJson(company)]);
});

export const getCompany = asyncHandler(async (req, res) => {
  const db = getDb();
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) throw notFound('Company not found');

  if (!req.user.isSuperAdmin && company.id !== req.user.companyId) {
    throw forbidden('You cannot access another company');
  }

  return ok(res, companyToJson(company));
});

const UPDATABLE = [
  'name',
  'email',
  'phone',
  'website',
  'address',
  'city',
  'state',
  'country',
  'postalCode',
  'currency',
  'timezone',
  'logoUrl',
  'faviconUrl',
  'brandColor',
];

export const updateCompany = asyncHandler(async (req, res) => {
  const db = getDb();
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) throw notFound('Company not found');

  if (!req.user.isSuperAdmin && company.id !== req.user.companyId) {
    throw forbidden('You cannot modify another company');
  }

  const sets = [];
  const values = [];
  for (const field of UPDATABLE) {
    if (req.body[field] !== undefined) {
      const column =
        {
          postalCode: 'postal_code',
          logoUrl: 'logo_url',
          faviconUrl: 'favicon_url',
          brandColor: 'brand_color',
        }[field] || field;
      sets.push(`${column} = ?`);
      values.push(req.body[field]);
    }
  }
  if (req.body.name !== undefined) {
    sets.push('slug = ?');
    values.push(slugify(req.body.name));
  }

  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(req.params.id);
    db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  req.audit?.('company.update', { entityType: 'company', entityId: company.id });

  const updated = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  return ok(res, companyToJson(updated));
});

// ---------------------------------------------------------------------------
// Company Admin first-login setup (Phase 15). Completes the company profile and
// marks the tenant as onboarded. Reuses the same updatable profile fields as
// updateCompany but additionally stamps `companies.onboarded_at`.
// ---------------------------------------------------------------------------
export const completeCompanySetup = asyncHandler(async (req, res) => {
  const db = getDb();
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) throw notFound('Company not found');

  if (!req.user.isSuperAdmin && company.id !== req.user.companyId) {
    throw forbidden('You cannot modify another company');
  }

  const sets = [];
  const values = [];
  for (const field of UPDATABLE) {
    if (req.body[field] !== undefined) {
      const column =
        {
          postalCode: 'postal_code',
          logoUrl: 'logo_url',
          faviconUrl: 'favicon_url',
          brandColor: 'brand_color',
        }[field] || field;
      sets.push(`${column} = ?`);
      values.push(req.body[field]);
    }
  }
  if (req.body.name !== undefined) {
    sets.push('slug = ?');
    values.push(slugify(req.body.name));
  }

  sets.push(
    "onboarded_at = COALESCE(onboarded_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"
  );
  values.push(req.params.id);
  db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  req.audit?.('company.setup_complete', { entityType: 'company', entityId: company.id });

  const updated = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  return ok(res, companyToJson(updated));
});
