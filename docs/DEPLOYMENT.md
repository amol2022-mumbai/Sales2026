# Production Deployment & Monitoring

This document is the operational runbook for deploying the Sales Management CRM
to production. It covers required environment variables, deployment and
rollback steps, backup/restore, and monitoring. Read it alongside `README.md`.

---

## 1. Architecture in production

- **Single process, single port.** The Node server serves both the API (`/api`)
  and the built SPA (static files + client-side fallback). No separate web
  server is required, though a reverse proxy in front is recommended for TLS.
- **SQLite** (`node:sqlite`, WAL mode) is the datastore. It is a single file;
  backup/restore is a file copy. There is no connection pool — the process holds
  one synchronous connection.
- **Tenant isolation** is enforced in the query layer: every business query is
  scoped by `company_id` derived server-side from the authenticated user, never
  from client input. Per-client deployments use separate `DB_PATH`s.

---

## 2. Required environment variables

Copy `.env.example` to `.env` and set real values. `.env` must never be
committed or web-accessible.

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` enables strict secret validation, production logging, gzip, static serving. |
| `PORT` | yes | Listen port (default `4000`). |
| `API_BASE_URL` | yes | Public base URL (used for links and fallback origin). |
| `CORS_ORIGINS` | yes | Comma-separated allow-list of frontend origins. |
| `TRUST_PROXY` | — | `1` behind a single reverse proxy; `0` otherwise. Used for rate-limit IP detection. |
| `DB_PATH` | yes | SQLite file path, relative to `server/`. |
| `JWT_SECRET` | **yes** | Strong random secret. `openssl rand -hex 48`. Boot refuses to start if missing/placeholder. |
| `JWT_EXPIRES_IN` | — | Token lifetime (default `8h`). |
| `SEED_ADMIN_NAME` | — | Super admin display name. |
| `SEED_ADMIN_EMAIL` | — | Super admin login email. |
| `SEED_ADMIN_PASSWORD` | **yes** | One-time bootstrap password. Boot refuses to start in production if still `ChangeMe123!`. |
| `SEED_COMPANY_NAME` | — | Name of the seed client. |
| `APP_NAME` / `APP_BRAND_COLOR` / `APP_LOGO_URL` / `APP_FAVICON_URL` | — | Fallback white-label branding. |
| `APP_URL` | — | Public app base URL used to build absolute links in emails (e.g. the company-admin invitation). Empty = relative `/accept-invite` links. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | — | Outbound SMTP for invitation emails. When `SMTP_HOST`/`SMTP_FROM` are empty, email is disabled and the invitation link is returned in the API response for manual sharing. |
| `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL` / `AI_BASE_URL` / `AI_TIMEOUT_MS` | — | Optional. Blank = deterministic offline assistant. Secrets are server-side only. |
| `PAYMENT_PROVIDER` | — | Provider id (default `stripe`). |
| `PAYMENT_MODE` | — | `test` or `live`. |
| `PAYMENT_SECRET_KEY` | — | Empty = mock checkout. Set to enable real payments. |
| `PAYMENT_WEBHOOK_SECRET` | **yes if** `PAYMENT_SECRET_KEY` set | Inbound webhooks are rejected (fail-closed) without it; boot refuses to start in production when the secret key is set but this is missing. |
| `PAYMENT_MOCK` | — | `0`/`1`. Ignored when `PAYMENT_SECRET_KEY` is set. |

**Secrets handling rules**

- Secrets are read server-side only and are never returned by `/api/config` or
  any public endpoint.
- The AI and payment secrets are never bundled into the frontend build.
- Production logging (morgan `combined`) logs request line, status and latency —
  it never logs request bodies or authorization headers.

---

## 3. Deployment steps

Prerequisites: Node.js 22.5+ (server engine requirement).

```bash
# 1. Install dependencies
npm ci

# 2. Build the frontend (produces web/dist, served by the Node server)
npm run build

# 3. Configure environment
cp .env.example .env
# Edit .env with production values (see section 2). NODE_ENV=production.

# 4. Seed foundational data (roles, permissions, plans, super admin).
#    Idempotent; safe to re-run. The server also seeds on first boot.
npm run seed

# 5. Start the server (systemd/PM2 recommended for process supervision)
npm run start
```

The server refuses to start in production when `validateEnv()` reports a
problem (missing/placeholder `JWT_SECRET`, placeholder admin password, or a live
payment secret without a webhook secret).

### Reverse proxy (recommended)

Terminate TLS at a reverse proxy (nginx/caddy/load balancer) and forward to the
Node process:

- Proxy `/` and `/api` to `http://127.0.0.1:PORT`.
- Set `TRUST_PROXY=1` so rate limiting sees real client IPs.
- Bind the Node process to localhost where possible.
- Preserve the raw webhook body for `POST /api/billing/webhook` (no re-encoding).

### Domain & HTTPS

- Serve over HTTPS only; redirect HTTP to HTTPS at the proxy.
- Per-client white-label domains are resolved from `companies.domain` via the
  `Host` header (`GET /api/config`), so no per-domain code or cert in the app.

---

## 4. Rollback procedure

The application and database are versioned together via idempotent, additive
migrations. Rolling back the code does not require rolling back the database.

```bash
# 1. Re-deploy the previous known-good commit/tag
git checkout <previous-good-tag>

# 2. Rebuild the frontend
npm ci
npm run build

# 3. Restart the server
#    systemd:  systemctl restart <service>
#    PM2:      pm2 reload <app>
```

Notes:

- Migrations are additive and idempotent, so an older binary can still read a
  newer database. Do **not** run destructive schema operations.
- If a rollback must also revert data, restore from the most recent verified
  backup (section 5) instead.

---

## 5. Backup, verification & restore

### Scheduled backup

`npm run backup` writes a consistent copy (via `VACUUM INTO` after a WAL
checkpoint) to `server/data/backups/crm-<timestamp>.db` and immediately
verifies it with `PRAGMA integrity_check`.

```bash
# Default: writes to server/data/backups/crm-<timestamp>.db and verifies it
npm run backup

# Custom target path
npm run backup /var/backups/crm/crm-$(date +%F).db
```

Schedule it (cron or systemd timer), keeping at least 7 days of history and
copying off-host:

```cron
# Example cron entry — run daily at 02:00
0 2 * * * cd /srv/crm && npm run backup >> /var/log/crm-backup.log 2>&1
```

The backup command exits non-zero if verification fails, so a cron job that
monitors exit status will catch corrupted backups.

### Restore procedure

```bash
# 1. Stop the application
#    systemctl stop <service>   (or: pm2 stop <app>)

# 2. Restore the backup file over DB_PATH
cp /var/backups/crm/crm-<date>.db server/data/crm.db
# Remove any stale WAL/SHM sidecar files alongside it

# 3. Start the application
#    systemctl start <service>
```

Always test a restore into a scratch directory and confirm
`GET /api/health/ready` returns `ready` before trusting the procedure.

---

## 6. Health, readiness & monitoring

### Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Liveness. Always `200` with service/uptime info. |
| `GET /api/health/db` | Database reachability (`SELECT 1`). |
| `GET /api/health/ready` | Readiness. `200` when the DB responds, `503` otherwise. |

Point load-balancer health checks at `/api/health/ready`.

### Logging

- Request logs: morgan (`combined` in production). No bodies, no auth headers.
- Errors: unhandled errors are logged server-side with `[unhandled]`; clients
  receive a generic `500` in production (no stack traces / internals leaked).
- Fatal signals: `uncaughtException` triggers a graceful shutdown;
  `unhandledRejection` is logged.

### Recommended monitoring

- **Uptime/liveness**: probe `/api/health/ready` every 30s; alert on non-200.
- **Rate limiting**: `429` responses on `/api/auth/login` (20/15min),
  `/api/auth/change-password` (20/15min), `/api/admin` (300/15min) and a broad
  `/api` limiter (2000/15min).
- **Backups**: monitor the backup job exit status and off-host copy freshness.
- **Logs**: ship server logs (stdout/stderr) to your log aggregator and rotate
  locally.

---

## 7. Production pre-flight checklist

- [ ] `NODE_ENV=production`; server boots (it refuses to start on invalid secrets).
- [ ] `JWT_SECRET` is a strong random value, not the placeholder.
- [ ] `SEED_ADMIN_PASSWORD` is not the default placeholder.
- [ ] If `PAYMENT_SECRET_KEY` is set, `PAYMENT_WEBHOOK_SECRET` is set and matches the provider.
- [ ] `CORS_ORIGINS` lists only real frontend origins.
- [ ] HTTPS/TLS enforced; HTTP redirects to HTTPS.
- [ ] Reverse proxy forwards `/` and `/api`; `TRUST_PROXY` set correctly.
- [ ] `.env` and `server/data/*.db` are excluded from the web root and version control.
- [ ] `GET /api/health`, `/api/health/db`, `/api/health/ready` all return `200`.
- [ ] SPA fallback serves `index.html` for non-`/api` routes; unknown `/api/*` returns `404`.
- [ ] Payment webhook rejects unsigned bodies (`400`); signed test event applies.
- [ ] Backup job runs and its verification reports `integrity ok`.
- [ ] Restore drill completed into a scratch DB and verified via `/api/health/ready`.
- [ ] Tenant isolation verified: a user of company A cannot read company B records.
- [ ] RBAC / billing / subscription / entitlement controls behave as in the test suite.

---

## 8. Automated verification

```bash
# Full backend test suite (tenant isolation, RBAC, billing, subscriptions, UAT)
npm test

# Production frontend build
npm run build

# Migration idempotency + production smoke (health/ready/db/login/SPA/webhook)
# See the server test suite (tests/performance.test.js, tests/deployment.test.js)
```

Run `npm test` and `npm run build` in CI before every production deploy.
