-- ============================================================================
-- Sales Management CRM - Database Schema
-- SQLite dialect. CREATE TABLE statements are idempotent; incremental column
-- additions for existing databases are applied by migrate.js (ensureColumns).
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Companies: top-level tenant for multi-company data isolation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  slug          TEXT    UNIQUE,
  email         TEXT,
  phone         TEXT,
  website       TEXT,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  country       TEXT,
  industry      TEXT,
  postal_code   TEXT,
  logo_url      TEXT,
  -- White-label branding (client-specific configuration).
  brand_color   TEXT,
  favicon_url   TEXT,
  domain        TEXT,
  currency      TEXT    NOT NULL DEFAULT 'USD',
  timezone      TEXT    NOT NULL DEFAULT 'UTC',
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  onboarded_at  TEXT,
  activated_at  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_companies_slug ON companies(slug);
CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);
-- idx_companies_domain is created in migrate.js after the incremental
-- `domain` column migration (it does not exist on legacy databases yet).

-- ---------------------------------------------------------------------------
-- Plans: subscription tiers offered to clients. `user_limit` (-1 = unlimited)
-- and `modules` (JSON array; NULL = all modules) are the plan defaults which
-- can be overridden per-license.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  key                   TEXT    NOT NULL UNIQUE,
  name                  TEXT    NOT NULL,
  description           TEXT,
  user_limit            INTEGER NOT NULL DEFAULT -1,
  modules               TEXT,
  price_monthly         REAL    NOT NULL DEFAULT 0,
  price_annual          REAL    NOT NULL DEFAULT 0,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  is_active             INTEGER NOT NULL DEFAULT 1,
  storage_limit_mb      INTEGER NOT NULL DEFAULT -1,
  export_enabled        INTEGER NOT NULL DEFAULT 1,
  api_enabled           INTEGER NOT NULL DEFAULT 0,
  license_duration_days INTEGER NOT NULL DEFAULT 0,
  trial_days            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(is_active, sort_order);

-- ---------------------------------------------------------------------------
-- Licenses: per-client subscription. `status` is the license lifecycle state;
-- `expires_at` (NULL = never) drives automatic expiry; `user_limit` and
-- `modules` override the plan defaults when set (NULL = inherit plan).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS licenses (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  plan_id          INTEGER REFERENCES plans(id) ON DELETE SET NULL,
  status           TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','suspended','trial','cancelled','past_due')),
  starts_at        TEXT,
  expires_at       TEXT,
  past_due_at      TEXT,
  user_limit       INTEGER,
  modules          TEXT,
  storage_limit_mb INTEGER,
  export_enabled   INTEGER,
  api_enabled      INTEGER,
  billing_cycle    TEXT    CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly','annual')),
  auto_renew       INTEGER NOT NULL DEFAULT 1,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_licenses_plan ON licenses(plan_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_licenses_expiry ON licenses(expires_at);

-- ---------------------------------------------------------------------------
-- Plan feature limits (Phase 19): per-plan defaults for named limitable
-- features (see config/limits.js). A row is only present for features the
-- Super Admin has configured; `limit_value` = -1 means explicitly unlimited.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_limits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id     INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  feature_key TEXT    NOT NULL,
  limit_value INTEGER NOT NULL DEFAULT -1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (plan_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_plan_limits_plan ON plan_limits(plan_id);

-- ---------------------------------------------------------------------------
-- License feature limit overrides (Phase 19): per-tenant overrides of the
-- plan defaults. Absent rows inherit the plan; explicit rows win over the plan.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS license_limits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id  INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  feature_key TEXT    NOT NULL,
  limit_value INTEGER NOT NULL DEFAULT -1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (license_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_license_limits_license ON license_limits(license_id);

-- ---------------------------------------------------------------------------
-- Usage records (Phase 19): per-tenant, per-feature metered consumption for
-- monthly features. `period_key` is `YYYY-MM` for monthly features (resets each
-- calendar month). Absolute features derive usage from their source tables and
-- are not stored here. Strict tenant isolation via `company_id`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  feature_key TEXT    NOT NULL,
  period_key  TEXT    NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (company_id, feature_key, period_key)
);

CREATE INDEX IF NOT EXISTS idx_usage_records_company ON usage_records(company_id, feature_key);

-- ---------------------------------------------------------------------------
-- Subscription invoices: billing records issued to a tenant for their plan
-- (subscription billing). Distinct from the `invoices` table, which records a
-- tenant's own receivable/collection invoices against their customers. `status`
-- stores Unpaid/Partial/Paid/Void; the paid amount and balance are derived from
-- `subscription_payments` rather than stored.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no    TEXT,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_id       INTEGER REFERENCES plans(id) ON DELETE SET NULL,
  amount        REAL    NOT NULL DEFAULT 0,
  description   TEXT,
  period_start  TEXT,
  period_end    TEXT,
  due_date      TEXT,
  status        TEXT    NOT NULL DEFAULT 'Unpaid' CHECK (status IN ('Unpaid','Partial','Paid','Void')),
  billing_cycle TEXT    CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly','annual')),
  provider      TEXT,
  provider_id   TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_invoices_no ON subscription_invoices(invoice_no);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_company ON subscription_invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_plan ON subscription_invoices(plan_id);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_status ON subscription_invoices(status);

-- ---------------------------------------------------------------------------
-- Subscription payments: payments received against a subscription invoice.
-- Multiple payments may be applied to one invoice. Soft delete via `deleted_at`;
-- `payment_no` is the human-facing Payment ID.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_no   TEXT,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id   INTEGER NOT NULL REFERENCES subscription_invoices(id) ON DELETE CASCADE,
  amount       REAL    NOT NULL DEFAULT 0,
  payment_date TEXT    NOT NULL,
  method       TEXT    NOT NULL DEFAULT 'Bank Transfer',
  reference    TEXT,
  notes        TEXT,
  type         TEXT    NOT NULL DEFAULT 'payment' CHECK (type IN ('payment','refund')),
  provider     TEXT,
  provider_id  TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_payments_no ON subscription_payments(payment_no);
CREATE INDEX IF NOT EXISTS idx_sub_payments_company ON subscription_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_sub_payments_invoice ON subscription_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sub_payments_date ON subscription_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_sub_payments_deleted ON subscription_payments(deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_payments_provider ON subscription_payments(provider_id) WHERE provider_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Subscription events: verified payment-provider webhook events, stored
-- idempotently so retries never double-apply. `provider_event_id` is unique per
-- provider; `status` tracks the event processing state (received/processed/
-- failed/duplicate). The payload is the raw signed event for audit/retry.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  provider          TEXT    NOT NULL DEFAULT 'stripe',
  provider_event_id TEXT    NOT NULL,
  event_type        TEXT    NOT NULL,
  company_id        INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  invoice_id        INTEGER REFERENCES subscription_invoices(id) ON DELETE SET NULL,
  status            TEXT    NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','failed','duplicate')),
  payload           TEXT,
  processed_at      TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_events_provider ON subscription_events(provider, provider_event_id);
CREATE INDEX IF NOT EXISTS idx_sub_events_company ON subscription_events(company_id);
CREATE INDEX IF NOT EXISTS idx_sub_events_type ON subscription_events(event_type);
CREATE INDEX IF NOT EXISTS idx_sub_events_status ON subscription_events(status);

-- ---------------------------------------------------------------------------
-- Roles: system-defined access roles. is_super_admin bypasses RBAC checks.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  key            TEXT    NOT NULL UNIQUE,
  name           TEXT    NOT NULL,
  description    TEXT,
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- Permissions: granular capabilities, keyed as `module:action`.
-- Actions: view, create, edit, delete, export, approve, assign, manage.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT    NOT NULL UNIQUE,
  module      TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_permissions_module ON permissions(module);

-- ---------------------------------------------------------------------------
-- Role permissions: many-to-many join between roles and permissions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);

-- ---------------------------------------------------------------------------
-- Teams: sales teams within a company. lead_id = team leader, manager_id =
-- reporting sales manager. Both reference users.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  description TEXT,
  lead_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  manager_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_teams_company ON teams(company_id);
CREATE INDEX IF NOT EXISTS idx_teams_lead ON teams(lead_id);

-- ---------------------------------------------------------------------------
-- Users: application accounts. company_id drives tenant isolation.
-- Super admins may have company_id NULL (global access).
-- manager_id is the user's reporting manager (self-referencing).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  team_id       INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  manager_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  employee_id   TEXT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  phone         TEXT,
  job_title     TEXT,
  territory     TEXT,
  joining_date  TEXT,
  avatar_url    TEXT,
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','pending')),
  last_login_at TEXT,
  invitation_token TEXT,
  invitation_expires_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_invitation ON users(invitation_token);

-- ---------------------------------------------------------------------------
-- Notifications: in-app notification foundation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL DEFAULT 'info',
  title      TEXT    NOT NULL,
  body       TEXT,
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_company ON notifications(company_id);

-- ---------------------------------------------------------------------------
-- Audit logs: security / compliance trail. company_id may be NULL for
-- system-level actions (e.g. super admin login, seed).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT    NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  metadata    TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ---------------------------------------------------------------------------
-- Leads: sales leads captured and worked through the pipeline.
-- `company_name` is the prospect organisation (not the tenant); tenant
-- isolation is driven by `company_id`. Soft delete via `deleted_at`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_no          TEXT,
  company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  company_name     TEXT    NOT NULL,
  contact_person   TEXT,
  mobile           TEXT,
  whatsapp         TEXT,
  email            TEXT,
  address          TEXT,
  city             TEXT,
  state            TEXT,
  source           TEXT,
  product_service  TEXT,
  lead_value       REAL,
  priority         TEXT    NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High')),
  status           TEXT    NOT NULL DEFAULT 'New' CHECK (status IN (
                      'New','Contacted','Interested','Qualified','Proposal Sent',
                      'Negotiation','Won','Lost','Not Interested','Future Follow-up')),
  assigned_to      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  team_id          INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  next_follow_up   TEXT,
  notes            TEXT,
  remarks          TEXT,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at       TEXT,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_lead_no ON leads(lead_no);
CREATE INDEX IF NOT EXISTS idx_leads_company ON leads(company_id);
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_team ON leads(team_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_followup ON leads(next_follow_up);
CREATE INDEX IF NOT EXISTS idx_leads_deleted ON leads(deleted_at);

-- ---------------------------------------------------------------------------
-- Lead activities: immutable audit trail of everything that happens to a
-- lead (created, updated, status change, assignment, follow-up, notes).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_activities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type        TEXT    NOT NULL,
  description TEXT,
  metadata    TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON lead_activities(lead_id, created_at);

-- ---------------------------------------------------------------------------
-- Customers: accounts converted from leads or created directly. `name` is the
-- customer organisation; tenant isolation via `company_id`. `lead_id` links
-- the originating lead so the full lead history is preserved. Soft delete
-- via `deleted_at`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_no    TEXT,
  company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  contact_person TEXT,
  mobile         TEXT,
  whatsapp       TEXT,
  email          TEXT,
  address        TEXT,
  city           TEXT,
  state          TEXT,
  gst            TEXT,
  pan            TEXT,
  customer_type  TEXT    NOT NULL DEFAULT 'Company' CHECK (customer_type IN (
                   'Individual','Company','Government','Distributor',
                   'Retailer','Wholesaler','Other')),
  status         TEXT    NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive','Blocked')),
  assigned_to    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  team_id        INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  lead_id        INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_customer_no ON customers(customer_no);
CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_assigned ON customers(assigned_to);
CREATE INDEX IF NOT EXISTS idx_customers_team ON customers(team_id);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_lead ON customers(lead_id);
CREATE INDEX IF NOT EXISTS idx_customers_created ON customers(created_at);
CREATE INDEX IF NOT EXISTS idx_customers_deleted ON customers(deleted_at);

-- ---------------------------------------------------------------------------
-- Customer activities: immutable CRM trail (created, updated, status,
-- assignment, notes, calls, meetings, follow-ups, complaints, conversion).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_activities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type        TEXT    NOT NULL,
  description TEXT,
  metadata    TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_activities_customer ON customer_activities(customer_id, created_at);

-- ---------------------------------------------------------------------------
-- Follow-ups: unified activity/follow-up management for leads and customers.
-- `target_type` + `lead_id`/`customer_id` link the follow-up to its entity.
-- `status` stores Pending/Completed/Rescheduled/Cancelled; "Overdue" is derived
-- (Pending with follow_up_date in the past) rather than stored. Soft delete
-- via `deleted_at`. `rescheduled_from` links the follow-up that was superseded.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follow_ups (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  target_type        TEXT    NOT NULL CHECK (target_type IN ('lead','customer')),
  lead_id            INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  customer_id        INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  contact_person     TEXT,
  activity_type      TEXT    NOT NULL CHECK (activity_type IN (
                       'call','whatsapp','email','meeting','site_visit',
                       'demo','presentation','note','follow_up')),
  follow_up_date     TEXT    NOT NULL,
  follow_up_time     TEXT,
  priority           TEXT    NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High')),
  status             TEXT    NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Completed','Rescheduled','Cancelled')),
  assigned_to        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  team_id            INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  notes              TEXT,
  next_action        TEXT,
  next_follow_up_date TEXT,
  completed_at       TEXT,
  completed_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rescheduled_from   INTEGER REFERENCES follow_ups(id) ON DELETE SET NULL,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at         TEXT,
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_company ON follow_ups(company_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_lead ON follow_ups(lead_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_customer ON follow_ups(customer_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_assigned ON follow_ups(assigned_to);
CREATE INDEX IF NOT EXISTS idx_follow_ups_team ON follow_ups(team_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_date ON follow_ups(follow_up_date);
CREATE INDEX IF NOT EXISTS idx_follow_ups_deleted ON follow_ups(deleted_at);

-- ---------------------------------------------------------------------------
-- Opportunities: sales pipeline deals connecting leads and customers to
-- revenue. `target_type` + `lead_id`/`customer_id` link the opportunity to its
-- entity. `stage` follows the sales pipeline; `deal_value` and `probability`
-- feed the weighted pipeline (deal_value * probability / 100). Soft delete via
-- `deleted_at`. `opportunity_no` is the human-facing Opportunity ID.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opportunities (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_no      TEXT,
  company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  target_type         TEXT    NOT NULL CHECK (target_type IN ('lead','customer')),
  lead_id             INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  customer_id         INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  contact_person      TEXT,
  product_service     TEXT,
  deal_value          REAL,
  probability         INTEGER NOT NULL DEFAULT 0 CHECK (probability >= 0 AND probability <= 100),
  expected_close_date TEXT,
  assigned_to         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  team_id             INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  stage               TEXT    NOT NULL DEFAULT 'New' CHECK (stage IN (
                        'New','Contacted','Qualified','Proposal','Negotiation',
                        'Won','Lost')),
  priority            TEXT    NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High')),
  notes               TEXT,
  next_action         TEXT,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at          TEXT,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_no ON opportunities(opportunity_no);
CREATE INDEX IF NOT EXISTS idx_opportunities_company ON opportunities(company_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_lead ON opportunities(lead_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_customer ON opportunities(customer_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_assigned ON opportunities(assigned_to);
CREATE INDEX IF NOT EXISTS idx_opportunities_team ON opportunities(team_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(stage);
CREATE INDEX IF NOT EXISTS idx_opportunities_close ON opportunities(expected_close_date);
CREATE INDEX IF NOT EXISTS idx_opportunities_deleted ON opportunities(deleted_at);

-- ---------------------------------------------------------------------------
-- Opportunity activities: immutable history for an opportunity (created,
-- updated, stage change, value change, assignment, notes, won, lost).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opportunity_activities (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type           TEXT    NOT NULL,
  description    TEXT,
  metadata       TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_opportunity_activities_opp ON opportunity_activities(opportunity_id, created_at);

-- ---------------------------------------------------------------------------
-- Targets: sales performance targets. A target is scoped to a company, team,
-- salesperson, product/service or territory and measures a result type
-- (revenue, collection, new leads, new customers, conversion rate) over a
-- monthly / quarterly / annual period. Achievement is computed from real
-- source data (won opportunities, leads, customers) rather than stored.
-- Soft delete via `deleted_at`; `target_no` is the human-facing Target ID.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS targets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  target_no     TEXT,
  company_id    INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  scope         TEXT    NOT NULL CHECK (scope IN ('company','team','user','product','territory')),
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  team_id       INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  product       TEXT,
  territory     TEXT,
  target_type   TEXT    NOT NULL CHECK (target_type IN (
                  'sales','collection','new_leads','new_customers','conversion_rate')),
  period_type   TEXT    NOT NULL CHECK (period_type IN ('monthly','quarterly','annual')),
  target_value  REAL    NOT NULL,
  start_date    TEXT    NOT NULL,
  end_date      TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Paused','Completed','Cancelled')),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_targets_no ON targets(target_no);
CREATE INDEX IF NOT EXISTS idx_targets_company ON targets(company_id);
CREATE INDEX IF NOT EXISTS idx_targets_user ON targets(user_id);
CREATE INDEX IF NOT EXISTS idx_targets_team ON targets(team_id);
CREATE INDEX IF NOT EXISTS idx_targets_type ON targets(target_type);
CREATE INDEX IF NOT EXISTS idx_targets_period ON targets(period_type);
CREATE INDEX IF NOT EXISTS idx_targets_status ON targets(status);
CREATE INDEX IF NOT EXISTS idx_targets_dates ON targets(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_targets_deleted ON targets(deleted_at);

-- ---------------------------------------------------------------------------
-- Products: company-wide product/service catalogue. Master data shared across
-- a tenant so sales, quotations and orders can reference it. Soft delete via
-- `deleted_at`; `product_no` is the human-facing Product ID.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_no   TEXT,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  sku          TEXT,
  category     TEXT,
  description  TEXT,
  unit         TEXT,
  unit_price   REAL    NOT NULL DEFAULT 0,
  tax_rate     REAL    NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_no ON products(product_no);
CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_deleted ON products(deleted_at);

-- ---------------------------------------------------------------------------
-- Quotations: proposal documents raised against a customer, made of line items
-- that reference the product catalogue. `subtotal`, `tax_amount` and `total`
-- are denormalized totals recomputed from line items on every write (never
-- fabricated from scratch). `status` stores Draft/Sent/Accepted/Rejected/
-- Cancelled; "Expired" is derived (a Sent quotation past `valid_until`). Soft
-- delete via `deleted_at`; `quotation_no` is the human-facing Quotation ID.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quotations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_no   TEXT,
  company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id    INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  status         TEXT    NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Sent','Accepted','Rejected','Cancelled')),
  valid_until    TEXT,
  subtotal       REAL    NOT NULL DEFAULT 0,
  tax_amount     REAL    NOT NULL DEFAULT 0,
  discount       REAL    NOT NULL DEFAULT 0,
  total          REAL    NOT NULL DEFAULT 0,
  assigned_to    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  team_id        INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  notes          TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quotations_no ON quotations(quotation_no);
CREATE INDEX IF NOT EXISTS idx_quotations_company ON quotations(company_id);
CREATE INDEX IF NOT EXISTS idx_quotations_customer ON quotations(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotations_opportunity ON quotations(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_quotations_assigned ON quotations(assigned_to);
CREATE INDEX IF NOT EXISTS idx_quotations_team ON quotations(team_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);
CREATE INDEX IF NOT EXISTS idx_quotations_deleted ON quotations(deleted_at);

-- ---------------------------------------------------------------------------
-- Quotation items: line items belonging to a quotation. Each item may link to
-- a product (snapshot of name/unit/price/tax taken at creation) or be a manual
-- line. `amount` is quantity * unit_price; tax is aggregated on the quotation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quotation_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name         TEXT    NOT NULL,
  unit         TEXT,
  quantity     REAL    NOT NULL DEFAULT 1,
  unit_price   REAL    NOT NULL DEFAULT 0,
  tax_rate     REAL    NOT NULL DEFAULT 0,
  amount       REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation ON quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_product ON quotation_items(product_id);

-- ---------------------------------------------------------------------------
-- Sales Orders: fulfilled work orders raised against a customer, optionally
-- originating from an accepted quotation. `subtotal`, `tax_amount` and `total`
-- are denormalized totals recomputed from line items on every write (never
-- fabricated from scratch). `status` stores Draft/Confirmed/Processing/
-- Completed/Cancelled and follows the lifecycle Draft -> Confirmed ->
-- Processing -> Completed (or Cancelled from any open state). Soft delete via
-- `deleted_at`; `order_no` is the human-facing Order ID.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no       TEXT,
  company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id    INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  quotation_id   INTEGER REFERENCES quotations(id) ON DELETE SET NULL,
  status         TEXT    NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Confirmed','Processing','Completed','Cancelled')),
  subtotal       REAL    NOT NULL DEFAULT 0,
  tax_amount     REAL    NOT NULL DEFAULT 0,
  discount       REAL    NOT NULL DEFAULT 0,
  total          REAL    NOT NULL DEFAULT 0,
  assigned_to    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  team_id        INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  notes          TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_no ON orders(order_no);
CREATE INDEX IF NOT EXISTS idx_orders_company ON orders(company_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_quotation ON orders(quotation_id);
CREATE INDEX IF NOT EXISTS idx_orders_assigned ON orders(assigned_to);
CREATE INDEX IF NOT EXISTS idx_orders_team ON orders(team_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_deleted ON orders(deleted_at);

-- ---------------------------------------------------------------------------
-- Order items: line items belonging to a sales order. Each item may link to a
-- product (snapshot of name/unit/price/tax taken at creation) or be a manual
-- line. `amount` is quantity * unit_price; tax is aggregated on the order.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name       TEXT    NOT NULL,
  unit       TEXT,
  quantity   REAL    NOT NULL DEFAULT 1,
  unit_price REAL    NOT NULL DEFAULT 0,
  tax_rate   REAL    NOT NULL DEFAULT 0,
  amount     REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- ---------------------------------------------------------------------------
-- Invoices: receivable/collection records raised against a customer. `amount`
-- is the invoiced total; the collected amount is derived from `payments`.
-- `status` stores Unpaid/Partial/Paid; "Overdue" is derived (unpaid balance
-- past `due_date`). Soft delete via `deleted_at`; `invoice_no` is the
-- human-facing Invoice ID.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no   TEXT,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount       REAL    NOT NULL DEFAULT 0,
  due_date     TEXT,
  status       TEXT    NOT NULL DEFAULT 'Unpaid' CHECK (status IN ('Unpaid','Partial','Paid')),
  assigned_to  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  team_id      INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_no ON invoices(invoice_no);
CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_assigned ON invoices(assigned_to);
CREATE INDEX IF NOT EXISTS idx_invoices_team ON invoices(team_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_deleted ON invoices(deleted_at);

-- ---------------------------------------------------------------------------
-- Payments: collections received against an invoice. Multiple payments can be
-- applied to one invoice (part payments). Soft delete via `deleted_at`;
-- `payment_no` is the human-facing Payment ID.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_no   TEXT,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id   INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount       REAL    NOT NULL DEFAULT 0,
  payment_date TEXT    NOT NULL,
  method       TEXT    NOT NULL DEFAULT 'Bank Transfer' CHECK (method IN (
                 'Cash','Bank Transfer','Cheque','UPI','Card','Other')),
  reference    TEXT,
  received_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_no ON payments(payment_no);
CREATE INDEX IF NOT EXISTS idx_payments_company ON payments(company_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_deleted ON payments(deleted_at);

-- ---------------------------------------------------------------------------
-- AI Assistant conversations: chat history scoped to a company and a user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_company ON ai_conversations(company_id);

-- ---------------------------------------------------------------------------
-- AI Assistant messages: user question + assistant answer within a conversation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT    NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id, id);

-- ---------------------------------------------------------------------------
-- AI usage logs: metadata-only trail for observability / billing. Deliberately
-- does NOT store the raw prompt or response (sensitive text), only dimensions
-- like provider, model, action, status, latency and character counts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  provider       TEXT,
  model          TEXT,
  action         TEXT    NOT NULL,
  status         TEXT    NOT NULL,
  latency_ms     INTEGER,
  prompt_chars   INTEGER,
  response_chars INTEGER,
  error_code     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_company ON ai_usage_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_action ON ai_usage_logs(action);

-- ---------------------------------------------------------------------------
-- App metadata: internal key/value store (e.g. seed version tracking).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
