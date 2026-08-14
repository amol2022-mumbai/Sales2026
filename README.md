# Sales Management CRM (White-label, Multi-client)

A full-featured Sales Management CRM with a reusable **white-label / multi-client**
layer. Each client gets their own branding, license, plan and data isolation,
deployed independently from a single repository.

## Features

- **Sales workflow**: leads, customers, pipeline (opportunities), follow-ups,
  targets, and sales-team hierarchy (users, teams, roles & permissions).
- **Collections**: invoices and payments with derived statuses (`Unpaid` /
  `Partial` / `Paid`), overdue detection and receivables ageing — computed from
  real data, never stored placeholders.
- **Reports & MIS**: 12 report types (sales, lead conversion, follow-ups,
  pipeline, target achievement, customers, products, territories, collections,
  ageing, won/lost, productivity) plus a management-information summary. Every
  report and MIS metric is computed server-side from tenant-scoped source data,
  with CSV / XLSX / PDF export.
- **Platform dashboard**: super-admin cross-tenant analytics (totals and
  per-company metrics) available only through the protected `/api/admin/*` API.
- **Role-based access control**: super admin, business owner, sales manager,
  team leader, sales executive, accountant, viewer.
- **Audit logs** for compliance and traceability.
- **White-label branding**: per-client company name, logo, favicon, brand colour,
  domain and contact details — served dynamically, never hard-coded.
- **Licensing**: per-client subscription with lifecycle states
  (`active`, `trial`, `expired`, `suspended`), expiry dates, user limits and
  per-client module enablement.
- **Strict data isolation**: every tenant row is scoped by `company_id`; no
  cross-client data access.
- **Responsive UI** (desktop / tablet / mobile) built with React + Tailwind.

## Architecture

```
server/  Express + SQLite (node:sqlite) REST API
  src/db/schema.sql        Tables incl. companies, plans, licenses
  src/db/seed.js           Roles, permissions, default plans, seed client + license
  src/db/migrate.js        Incremental column migrations (backward compatible)
  src/config/modules.js    Configurable module catalog
  src/services/licenseService.js   License resolution, module gating, user limits
  src/services/reportService.js    Report computations (role/data-scope aware)
  src/services/collectionService.js Invoice/payment balances & derived status
  src/middleware/auth.js   JWT auth + tenant/license enforcement
  src/routes/admin.routes.js        Super Admin API (clients, plans, licenses, dashboard)
  src/routes/report.routes.js       Reports API (JSON + CSV/XLSX/PDF export)
  src/routes/mis.routes.js          MIS summary API
  src/routes/collections.routes.js  Invoices & payments API
web/    React (Vite) + Tailwind SPA
  src/context/BrandContext.jsx       Fetches branding, applies CSS vars/title/favicon
  src/lib/brand.js                   Generates brand shade palette from a hex colour
  src/pages/AdminPage.jsx            Super Admin dashboard / clients / plans / licenses UI
  src/pages/CollectionsPage.jsx      Invoices, payments & ageing UI
  src/pages/ReportsPage.jsx          Report viewer with export
  src/pages/MISPage.jsx              Management information summary UI
```

## Quick start (development)

```bash
# 1. Install dependencies (root workspace)
npm install

# 2. Configure environment
cp .env.example .env
#    Edit .env: set JWT_SECRET, SEED_ADMIN_* credentials, APP_NAME, etc.

# 3. Seed the database (roles, permissions, default plans, seed client + license)
npm run seed

# 4. Run both server (port 4000) and web (port 5173)
npm run dev
```

Open `http://localhost:5173` and sign in with the super admin from `.env`
(`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).

## Environment variables

All sensitive configuration is environment-driven. Copy `.env.example` to `.env`
(never commit `.env`).

| Variable | Description |
| --- | --- |
| `NODE_ENV` | `development` / `test` / `production` |
| `PORT` | API server port (default `4000`) |
| `API_BASE_URL` | Public base URL of the API (links, CORS) |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `DB_PATH` | SQLite database path (relative to `server/`) |
| `JWT_SECRET` | Secret for signing JWTs (`openssl rand -hex 48`) |
| `JWT_EXPIRES_IN` | Token lifetime (e.g. `8h`) |
| `SEED_ADMIN_NAME` / `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Super admin created on seed |
| `SEED_COMPANY_NAME` | Name of the seed client |
| `APP_NAME` | Fallback app name used when no client branding is set |
| `APP_BRAND_COLOR` | Fallback brand colour (hex) |
| `APP_LOGO_URL` / `APP_FAVICON_URL` | Fallback logo / favicon URLs |

Database credentials, API keys and other secrets must **never** be committed to
the repository and **never** exposed in frontend code.

## Creating clients (white-label)

Clients are managed through the **Super Admin → Clients & Licensing** page:

1. **Clients** — create a client with name, domain, brand colour, logo/favicon
   URLs and status (`active` / `inactive` / `suspended`).
2. **Plans** — define subscription tiers: user limit, price and a module set
   (empty module set = all modules enabled).
3. **Licenses** — attach a license to a client: plan, lifecycle status, start /
   expiry dates, user limit and module overrides.

The same operations are available via the Super Admin REST API under
`/api/admin/*` (requires a super-admin JWT):

```bash
# Login as super admin
curl -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}'

# Create a client (using TOKEN from login)
curl -X POST http://localhost:4000/api/admin/clients \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Client X","domain":"crm.client-x.com","brandColor":"#0ea5e9","status":"active"}'

# Attach a license
curl -X PUT http://localhost:4000/api/admin/licenses/2 \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"active","planId":3,"expiresAt":"2027-01-01","userLimit":20}'
```

## Licensing

- A client **without** a license behaves as fully enabled (self-hosted /
  legacy single-tenant behaviour).
- A license has a lifecycle state: `active`, `trial`, `expired`, `suspended`.
- Expiry is automatic: an `active`/`trial` license past `expiresAt` transitions
  to `expired` on next access.
- `suspended` and `expired` clients receive a `403` with codes
  `LICENSE_SUSPENDED` / `LICENSE_EXPIRED`.
- `userLimit` is enforced on user creation (`403 USER_LIMIT_REACHED`);
  `-1` means unlimited.
- `modules` (JSON array; `null` = all) restrict which modules a client can use.
  Core/system modules (users, roles, settings, notifications, audit logs) are
  always available.

## Database

SQLite via `node:sqlite`. The schema lives in `server/src/db/schema.sql` and is
idempotent; incremental column additions for existing databases are handled by
`server/src/db/migrate.js` (`ensureColumn`), so upgrades preserve data.

```bash
npm run seed   # create/reseed foundational data
```

## Testing & build

```bash
npm test          # server test suite (node --test)
npm run build     # production frontend build
```

## Security

### Tenant isolation

Every tenant-scoped query is filtered by `company_id`, and every record-level
read/update/delete is guarded by a data-scope check (`access.js`). Cross-tenant
access via changed IDs, query parameters, or direct API calls is denied with
`403`. A non-super-admin cannot set another tenant's `companyId` on create — the
server ignores the body value and always uses the authenticated user's company.

Super admins (cross-company/system administration) are guarded by
`requireSuperAdmin`; the entire `/api/admin/*` surface is super-admin-only.

### Report & MIS isolation

Reports and MIS summaries are computed **only on the server** and are scoped
through the authenticated user's data scope (`access.js`). A client user can
never read another tenant's data, and team leaders / sales executives see only
their team / their own records. Client-supplied `companyId` / `tenantId` is
**never trusted** — the server always derives the company from the JWT for
non-super-admin users (super admins must pass `companyId` explicitly and are
otherwise rejected). The same scoped query results are reused for CSV / XLSX /
PDF export, so exported files cannot leak cross-tenant data either.

### Authentication & sessions

- JWT (`HS256`) with `issuer` / `audience` claims; tokens are validated against
  both and rejected if tampered, expired, or signed by another party.
- Passwords are hashed with `bcrypt` (12 salt rounds). Login failures run a
  constant-time dummy comparison to avoid email enumeration via timing.
- `POST /api/auth/login`, `POST /api/auth/change-password`, and `/api/admin/*`
  are rate-limited per IP; a broad per-IP limiter covers the whole API.

### Authorization & licensing

- RBAC (`rbac.js`) gates every business route by `module:action` permission.
- License state (`active`/`trial`/`expired`/`suspended`), module gating, and
  `userLimit` are enforced **in middleware**, not just in the UI: `403` with
  codes `LICENSE_SUSPENDED`, `LICENSE_EXPIRED`, `MODULE_DISABLED`,
  `USER_LIMIT_REACHED`.

### Input, transport & output

- All SQL uses parameterised statements; user input never reaches SQL text
  (column/order names come from fixed allowlists).
- Request bodies are validated with `zod` and capped at `1mb`.
- Import files (CSV/XLSX) are capped at 10,000 data rows.
- `helmet` sets security headers including a restrictive Content Security
  Policy; CORS is allow-listed via `CORS_ORIGINS` (open to localhost only in
  development, and never in production).
- Unknown server errors are hidden from responses in production (only
  `HttpError`/validation messages are surfaced). Passwords, JWT secrets, API
  keys, and license internals are never returned to clients or logged.

### Audit logging

Security-relevant actions are recorded to `audit_logs`, including login success
and **login failure** (`auth.login_failed` with the reason), user
create/update/reset/status, license/plan/client changes, role-permission
updates, and all super-admin actions.

### Security testing

`server/tests/security.test.js` covers the security guarantees above. The wider
suite also asserts tenant isolation, license/module/user-limit enforcement,
permission boundaries, cross-tenant report/export isolation, and
report-accuracy (real calculations from seeded data).

```bash
node --test tests/security.test.js    # security-focused tests only
node --test tests/reports.test.js tests/collections.test.js  # Phase 10 tests
npm test                              # full suite (includes security tests)
```

## Deployment (Hostinger / shared Node hosting)

A single client is deployed independently with its own database and
environment. Steps:

1. **Build the frontend**

   ```bash
   npm run build
   # produces web/dist/
   ```

2. **Set up the server** on the host (Node 22+ required):

   ```bash
   npm ci
   cp .env.example .env
   # edit .env with production values:
   #   NODE_ENV=production
   #   PORT=<app port>
   #   API_BASE_URL=https://<your-domain>
   #   CORS_ORIGINS=https://<your-domain>
   #   DB_PATH=./data/crm.db
   #   JWT_SECRET=<strong secret>
   #   SEED_ADMIN_* (only for the very first seed)
   npm run seed
   npm run start
   ```

3. **Serve the SPA.** Either serve `web/dist` as static files with the API
   reverse-proxied at `/api`, or have Express serve the built assets. Requests
   from the SPA go to `/api/*` — ensure the web server proxies `/api` to the
   Node app.

4. **Point the client domain** (e.g. `crm.client-x.com`) at the deployment and
   set the client's `domain` in the Super Admin UI so branding resolves
   correctly.

5. **Per-client isolation**: run one deployment per client, each with its own
   `DB_PATH` and `.env`. No client data is shared across databases.

### Production security checklist

- [ ] `NODE_ENV=production` is set.
- [ ] `JWT_SECRET` is a strong random value (`openssl rand -hex 48`); never the
      placeholder.
- [ ] `CORS_ORIGINS` lists only your real frontend domain(s).
- [ ] `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` are changed after first seed;
      the seed password is a one-time bootstrap.
- [ ] Serve the app over HTTPS (TLS) only; redirect HTTP to HTTPS.
- [ ] Reverse-proxy `/api` to the Node app and keep the Node process bound to
      `127.0.0.1` where possible.
- [ ] The `.env` and database file (`server/data/*.db`) are not web-accessible
      and not in version control.
- [ ] Set a process manager (systemd / PM2) and log rotation for the server.

### Backup & recovery

SQLite is a single file, so backup = a safe file copy of the running database.

```bash
# Consistent backup (SQLite online backup API)
sqlite3 server/data/crm.db ".backup '/backups/crm-$(date +%F).db'"
```

- Schedule daily backups to an external location; keep at least 7 days of
  history and test restores regularly.
- For recovery, stop the app, restore the backup file over `DB_PATH`, then
  restart. Run `npm run seed` only for a fresh install (it re-creates
  foundational data — do not run it against an existing production database).

## Notes

- Never hard-code client names, logos, colours or domains in the frontend —
  they are served dynamically via `GET /api/config` and the login/`me`
  responses.
- `.env`, `*.db`, `server/data/` and build output are git-ignored.
