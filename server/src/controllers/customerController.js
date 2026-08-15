import { getDb } from '../db/connection.js';
import { notFound, forbidden, badRequest, conflict } from '../lib/httpError.js';
import { ok, created, paginated } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { hasPermission } from '../services/userService.js';
import {
  getUserDataScope,
  buildCustomerScopeWhere,
  canAccessCustomer,
  canAssignCustomerTo,
  canAccessLead,
} from '../services/access.js';
import {
  CUSTOMER_TYPES,
  CUSTOMER_STATUSES,
  buildCustomerHeaderMap,
  normalizeCustomerRow,
  customerDuplicateKeys,
  customerBufferToRows,
  base64ToBuffer,
  customersToCsv,
  customersToXlsx,
} from '../services/customerFiles.js';

const MAX_IMPORT_ROWS = 10000;

const CUSTOMER_SELECT = `
  SELECT c.*, u.name AS assigned_name, u.email AS assigned_email,
         t.name AS team_name, cr.name AS created_by_name, l.lead_no AS source_lead_no
  FROM customers c
  LEFT JOIN users u ON u.id = c.assigned_to
  LEFT JOIN teams t ON t.id = c.team_id
  LEFT JOIN users cr ON cr.id = c.created_by
  LEFT JOIN leads l ON l.id = c.lead_id
`;

const SORTABLE = {
  customerNo: 'c.customer_no',
  name: 'c.name',
  contactPerson: 'c.contact_person',
  customerType: 'c.customer_type',
  status: 'c.status',
  createdAt: 'c.created_at',
};

function customerToJson(c) {
  return {
    id: c.id,
    customerNo: c.customer_no,
    companyId: c.company_id,
    name: c.name,
    contactPerson: c.contact_person,
    mobile: c.mobile,
    whatsapp: c.whatsapp,
    email: c.email,
    address: c.address,
    city: c.city,
    state: c.state,
    gst: c.gst,
    pan: c.pan,
    customerType: c.customer_type,
    status: c.status,
    assignedTo: c.assigned_to,
    assignedName: c.assigned_name || null,
    assignedEmail: c.assigned_email || null,
    teamId: c.team_id,
    teamName: c.team_name || null,
    leadId: c.lead_id,
    leadNo: c.source_lead_no || null,
    createdBy: c.created_by,
    createdByName: c.created_by_name || null,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

function insertCustomerActivity(db, { customerId, userId, type, description, metadata = null }) {
  const info = db
    .prepare(
      `INSERT INTO customer_activities (customer_id, user_id, type, description, metadata)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(customerId, userId, type, description, metadata ? JSON.stringify(metadata) : null);
  return Number(info.lastInsertRowid);
}

function customerActivityToJson(a) {
  return {
    id: a.id,
    customerId: a.customer_id,
    userId: a.user_id,
    userName: a.user_name || null,
    type: a.type,
    description: a.description,
    metadata: a.metadata ? JSON.parse(a.metadata) : null,
    createdAt: a.created_at,
  };
}

function scopedCustomerWhere(scope, extraClauses = [], extraParams = [], alias = 'c') {
  const { where, params } = buildCustomerScopeWhere(scope, alias);
  const clauses = [...extraClauses, `${alias}.deleted_at IS NULL`];
  const whereSql = where ? `${where} AND ${clauses.join(' AND ')}` : `WHERE ${clauses.join(' AND ')}`;
  return { where: whereSql, params: [...params, ...extraParams] };
}

function resolveTargetCompany(req) {
  if (req.user.isSuperAdmin) return req.body.companyId ?? null;
  return req.user.companyId;
}

/** Validate team / assignee choices for a customer create/update/convert. */
function resolveCustomerAssignment(db, req, scope, companyId, { assignedTo, teamId }) {
  let teamIdVal = teamId ?? null;
  let assignedToVal = assignedTo ?? null;

  if (teamIdVal != null) {
    const team = db.prepare('SELECT id, company_id FROM teams WHERE id = ?').get(teamIdVal);
    if (!team || team.company_id !== companyId) throw badRequest('Invalid team');
    if (scope.type === 'teams' || scope.type === 'team') {
      if (!scope.teamIds.includes(teamIdVal)) throw forbidden('You can only assign customers to teams you manage');
    } else if (scope.type === 'self' && teamIdVal !== req.user.teamId) {
      throw forbidden('You can only assign customers to your own team');
    }
  }

  if (assignedToVal != null) {
    const target = db.prepare('SELECT id, company_id, team_id FROM users WHERE id = ?').get(assignedToVal);
    if (!target || target.company_id !== companyId) throw badRequest('Invalid assignee');
    if (assignedToVal !== req.user.id && !hasPermission(req.user, 'customers:assign')) {
      throw forbidden('You do not have permission to assign customers to others');
    }
    if (!canAssignCustomerTo(scope, target)) {
      throw forbidden('You can only assign customers within your scope');
    }
  }

  return { teamIdVal, assignedToVal };
}

/** Return a human label if a customer with the same identity already exists. */
function findCustomerDuplicate(db, companyId, { name, email, mobile, gst }) {
  const nameKey = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const rows = db
    .prepare('SELECT name, email, mobile, gst FROM customers WHERE company_id = ? AND deleted_at IS NULL')
    .all(companyId);
  const nm = nameKey(name);
  for (const r of rows) {
    if (nm && nameKey(r.name) === nm) {
      if (email && r.email && nameKey(r.email) === nameKey(email)) return 'company + email';
      if (mobile && r.mobile && nameKey(r.mobile) === nameKey(mobile)) return 'company + mobile';
      if (gst && r.gst && nameKey(r.gst) === nameKey(gst)) return 'company + GST';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const listCustomers = asyncHandler(async (req, res) => {
  const db = getDb();
  const { page, pageSize, search, status, customerType, assignedTo, teamId, companyId, sort, order } = req.query;
  const scope = getUserDataScope(req.user);

  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(c.customer_no LIKE ? OR c.name LIKE ? OR c.contact_person LIKE ? OR c.mobile LIKE ? OR c.email LIKE ? OR c.gst LIKE ? OR c.pan LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }
  if (status) {
    clauses.push('c.status = ?');
    params.push(status);
  }
  if (customerType) {
    clauses.push('c.customer_type = ?');
    params.push(customerType);
  }
  if (assignedTo) {
    clauses.push('c.assigned_to = ?');
    params.push(assignedTo);
  }
  if (teamId) {
    clauses.push('c.team_id = ?');
    params.push(teamId);
  }
  if (companyId && req.user.isSuperAdmin) {
    clauses.push('c.company_id = ?');
    params.push(companyId);
  }

  const { where, params: whereParams } = scopedCustomerWhere(scope, clauses, params, 'c');

  const sortColumn = SORTABLE[sort] || 'c.created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const total = db.prepare(`SELECT COUNT(*) AS count FROM customers c ${where}`).get(...whereParams).count;
  const rows = db
    .prepare(`${CUSTOMER_SELECT} ${where} ORDER BY ${sortColumn} ${sortOrder}, c.id DESC LIMIT ? OFFSET ?`)
    .all(...whereParams, pageSize, (page - 1) * pageSize);

  return paginated(res, rows.map(customerToJson), { page, pageSize, total });
});

export const getCustomer = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare(`${CUSTOMER_SELECT} WHERE c.id = ?`).get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Customer not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessCustomer(scope, row)) throw forbidden('You cannot access this customer');

  const activities = db
    .prepare(
      `SELECT a.*, u.name AS user_name
       FROM customer_activities a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.customer_id = ? ORDER BY a.created_at DESC, a.id DESC`
    )
    .all(row.id)
    .map(customerActivityToJson);

  // Linked lead history (preserved from conversion).
  let leadHistory = null;
  if (row.lead_id) {
    const lead = db.prepare('SELECT id, lead_no, company_name, contact_person, email, status, created_at FROM leads WHERE id = ?').get(row.lead_id);
    if (lead) {
      const leadActivities = db
        .prepare(
          `SELECT a.*, u.name AS user_name
           FROM lead_activities a LEFT JOIN users u ON u.id = a.user_id
           WHERE a.lead_id = ? ORDER BY a.created_at DESC, a.id DESC`
        )
        .all(lead.id)
        .map((a) => ({
          id: a.id,
          userId: a.user_id,
          userName: a.user_name || null,
          type: a.type,
          description: a.description,
          metadata: a.metadata ? JSON.parse(a.metadata) : null,
          createdAt: a.created_at,
        }));
      leadHistory = { ...lead, activities: leadActivities };
    }
  }

  const customer = customerToJson(row);
  customer.activities = activities;
  customer.leadHistory = leadHistory;
  customer.calls = activities.filter((a) => a.type === 'call');
  customer.meetings = activities.filter((a) => a.type === 'meeting');
  customer.followUps = activities.filter((a) => a.type === 'follow_up');
  customer.complaints = activities.filter((a) => a.type === 'complaint');
  customer.notes = activities.filter((a) => a.type === 'note');

  // Quotations are built; expose the customer's quotations (newest first).
  // Sales / Orders / Payments remain future modules with empty buckets so the
  // profile UI is wired end-to-end without fake data.
  customer.quotations = db
    .prepare(
      `SELECT id, quotation_no, status, total, valid_until, created_at
       FROM quotations
       WHERE customer_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC`
    )
    .all(row.id)
    .map((q) => ({
      id: q.id,
      quotationNo: q.quotation_no,
      status: q.status,
      total: q.total,
      validUntil: q.valid_until,
      createdAt: q.created_at,
    }));
  customer.orders = [];
  customer.sales = [];
  customer.payments = [];
  customer.kpis = {
    totalSales: 0,
    outstanding: 0,
    lastPurchase: null,
    orderCount: 0,
    status: customer.status,
  };

  return ok(res, customer);
});

export const customerMeta = asyncHandler(async (_req, res) => {
  return ok(res, { types: CUSTOMER_TYPES, statuses: CUSTOMER_STATUSES });
});

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export const createCustomer = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const companyId = resolveTargetCompany(req);
  if (!companyId) throw badRequest('A company is required to create a customer');

  const { teamIdVal, assignedToVal } = resolveCustomerAssignment(db, req, scope, companyId, {
    assignedTo: req.body.assignedTo ?? (req.user.isSuperAdmin ? null : req.user.id),
    teamId: req.body.teamId ?? req.user.teamId ?? null,
  });

  const b = req.body;
  const dup = findCustomerDuplicate(db, companyId, { name: b.name, email: b.email ?? null, mobile: b.mobile ?? null, gst: b.gst ?? null });
  if (dup) throw conflict(`A customer already exists for this ${dup}`);

  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        `INSERT INTO customers (company_id, name, contact_person, mobile, whatsapp, email, address, city, state,
                                gst, pan, customer_type, status, assigned_to, team_id, lead_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        companyId,
        b.name,
        b.contactPerson ?? null,
        b.mobile ?? null,
        b.whatsapp ?? null,
        b.email ?? null,
        b.address ?? null,
        b.city ?? null,
        b.state ?? null,
        b.gst ?? null,
        b.pan ?? null,
        b.customerType ?? 'Company',
        b.status ?? 'Active',
        assignedToVal,
        teamIdVal,
        null,
        req.user.id
      );
    const customerId = Number(info.lastInsertRowid);
    const customerNo = `CUST-${String(customerId).padStart(6, '0')}`;
    db.prepare('UPDATE customers SET customer_no = ? WHERE id = ?').run(customerNo, customerId);
    insertCustomerActivity(db, { customerId, userId: req.user.id, type: 'created', description: 'Customer created' });
    db.exec('COMMIT');

    req.audit?.('customer.create', { entityType: 'customer', entityId: customerId, metadata: { name: b.name } });

    const createdRow = db.prepare(`${CUSTOMER_SELECT} WHERE c.id = ?`).get(customerId);
    return created(res, customerToJson(createdRow));
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
});

const UPDATABLE_FIELDS = {
  name: 'name',
  contactPerson: 'contact_person',
  mobile: 'mobile',
  whatsapp: 'whatsapp',
  email: 'email',
  address: 'address',
  city: 'city',
  state: 'state',
  gst: 'gst',
  pan: 'pan',
  customerType: 'customer_type',
  status: 'status',
};

export const updateCustomer = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Customer not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessCustomer(scope, row)) throw forbidden('You cannot modify this customer');

  const b = req.body;
  const sets = [];
  const values = [];
  const changed = [];

  for (const [input, column] of Object.entries(UPDATABLE_FIELDS)) {
    if (b[input] === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(b[input]);
    changed.push(input);
  }

  let assignedToVal = row.assigned_to;
  if (b.assignedTo !== undefined) {
    const resolved = resolveCustomerAssignment(db, req, scope, row.company_id, { assignedTo: b.assignedTo, teamId: undefined });
    assignedToVal = resolved.assignedToVal;
    sets.push('assigned_to = ?');
    values.push(assignedToVal);
  }

  let teamIdVal = row.team_id;
  if (b.teamId !== undefined) {
    const resolved = resolveCustomerAssignment(db, req, scope, row.company_id, { assignedTo: undefined, teamId: b.teamId });
    teamIdVal = resolved.teamIdVal;
    sets.push('team_id = ?');
    values.push(teamIdVal);
  }

  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(row.id);
    db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  if (b.status !== undefined && b.status !== row.status) {
    insertCustomerActivity(db, {
      customerId: row.id,
      userId: req.user.id,
      type: 'status',
      description: `Status changed from ${row.status} to ${b.status}`,
      metadata: { from: row.status, to: b.status },
    });
  }
  if (b.assignedTo !== undefined && assignedToVal !== row.assigned_to) {
    const name = assignedToVal ? db.prepare('SELECT name FROM users WHERE id = ?').get(assignedToVal)?.name : null;
    insertCustomerActivity(db, {
      customerId: row.id,
      userId: req.user.id,
      type: 'assigned',
      description: assignedToVal ? `Assigned to ${name}` : 'Unassigned',
      metadata: { from: row.assigned_to, to: assignedToVal },
    });
  }
  if (changed.length) {
    insertCustomerActivity(db, {
      customerId: row.id,
      userId: req.user.id,
      type: 'updated',
      description: `Updated ${changed.join(', ')}`,
      metadata: { fields: changed },
    });
  }

  req.audit?.('customer.update', { entityType: 'customer', entityId: row.id });

  const updated = db.prepare(`${CUSTOMER_SELECT} WHERE c.id = ?`).get(row.id);
  return ok(res, customerToJson(updated));
});

export const deleteCustomer = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Customer not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessCustomer(scope, row)) throw forbidden('You cannot delete this customer');

  db.prepare("UPDATE customers SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);
  insertCustomerActivity(db, { customerId: row.id, userId: req.user.id, type: 'deleted', description: 'Customer deleted' });

  req.audit?.('customer.delete', { entityType: 'customer', entityId: row.id, metadata: { customerNo: row.customer_no } });

  return ok(res, { id: row.id, deleted: true });
});

export const addCustomerNote = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Customer not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessCustomer(scope, row)) throw forbidden('You cannot modify this customer');

  const activityId = insertCustomerActivity(db, { customerId: row.id, userId: req.user.id, type: 'note', description: req.body.note });
  req.audit?.('customer.note', { entityType: 'customer', entityId: row.id });

  const activity = db
    .prepare(`SELECT a.*, u.name AS user_name FROM customer_activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = ?`)
    .get(activityId);

  return ok(res, customerActivityToJson(activity));
});

export const addCustomerActivity = asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Customer not found');

  const scope = getUserDataScope(req.user);
  if (!canAccessCustomer(scope, row)) throw forbidden('You cannot modify this customer');

  const { type, description, scheduledAt } = req.body;
  const metadata = scheduledAt ? { scheduledAt } : null;
  const activityId = insertCustomerActivity(db, { customerId: row.id, userId: req.user.id, type, description, metadata });
  req.audit?.('customer.activity', { entityType: 'customer', entityId: row.id, metadata: { type } });

  const activity = db
    .prepare(`SELECT a.*, u.name AS user_name FROM customer_activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = ?`)
    .get(activityId);

  return ok(res, customerActivityToJson(activity));
});

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

export const bulkAssignCustomers = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const { customerIds, assignedTo } = req.body;

  let assignedToVal = assignedTo ?? null;
  if (assignedToVal != null) {
    const target = db.prepare('SELECT id, company_id, team_id FROM users WHERE id = ?').get(assignedToVal);
    if (!target) throw badRequest('Invalid assignee');
    if (!canAssignCustomerTo(scope, target)) throw forbidden('You can only assign customers within your scope');
  }

  const placeholders = customerIds.map(() => '?').join(', ');
  const targets = db.prepare(`SELECT * FROM customers WHERE id IN (${placeholders}) AND deleted_at IS NULL`).all(...customerIds);

  let updated = 0;
  let skipped = 0;
  for (const customer of targets) {
    if (!canAccessCustomer(scope, customer)) {
      skipped += 1;
      continue;
    }
    db.prepare("UPDATE customers SET assigned_to = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(assignedToVal, customer.id);
    const name = assignedToVal ? db.prepare('SELECT name FROM users WHERE id = ?').get(assignedToVal)?.name : null;
    insertCustomerActivity(db, {
      customerId: customer.id,
      userId: req.user.id,
      type: 'assigned',
      description: assignedToVal ? `Assigned to ${name}` : 'Unassigned',
      metadata: { from: customer.assigned_to, to: assignedToVal },
    });
    updated += 1;
  }

  req.audit?.('customer.bulk_assign', { entityType: 'customer', metadata: { count: updated, assignedTo: assignedToVal } });

  return ok(res, { updated, skipped });
});

export const bulkStatusCustomers = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const { customerIds, status } = req.body;

  const placeholders = customerIds.map(() => '?').join(', ');
  const targets = db.prepare(`SELECT * FROM customers WHERE id IN (${placeholders}) AND deleted_at IS NULL`).all(...customerIds);

  let updated = 0;
  let skipped = 0;
  for (const customer of targets) {
    if (!canAccessCustomer(scope, customer)) {
      skipped += 1;
      continue;
    }
    db.prepare("UPDATE customers SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(status, customer.id);
    insertCustomerActivity(db, {
      customerId: customer.id,
      userId: req.user.id,
      type: 'status',
      description: `Status changed from ${customer.status} to ${status}`,
      metadata: { from: customer.status, to: status },
    });
    updated += 1;
  }

  req.audit?.('customer.bulk_status', { entityType: 'customer', metadata: { count: updated, status } });

  return ok(res, { updated, skipped });
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const customerDashboard = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const { where, params } = scopedCustomerWhere(scope, [], []);

  const stats = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN status = 'Inactive' THEN 1 ELSE 0 END) AS inactive,
         SUM(CASE WHEN status = 'Blocked' THEN 1 ELSE 0 END) AS blocked,
         SUM(CASE WHEN assigned_to IS NULL THEN 1 ELSE 0 END) AS unassigned
       FROM customers c ${where}`
    )
    .get(...params);

  const byType = CUSTOMER_TYPES.map((type) => {
    const r = db.prepare(`SELECT COUNT(*) AS count FROM customers c ${where} AND c.customer_type = ?`).get(...params, type);
    return { type, count: r.count };
  });

  return ok(res, {
    total: stats.total || 0,
    active: stats.active || 0,
    inactive: stats.inactive || 0,
    blocked: stats.blocked || 0,
    unassigned: stats.unassigned || 0,
    byType,
  });
});

// ---------------------------------------------------------------------------
// Lead -> Customer conversion
// ---------------------------------------------------------------------------

export const convertLeadToCustomer = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const { leadId } = req.body;

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  if (!lead || lead.deleted_at) throw notFound('Lead not found');
  if (!canAccessLead(scope, lead)) throw forbidden('You cannot convert this lead');
  if (!['Qualified', 'Won'].includes(lead.status)) {
    throw badRequest('Only qualified or won leads can be converted to customers');
  }

  const companyId = lead.company_id;

  const existingByLead = db.prepare('SELECT id FROM customers WHERE lead_id = ? AND deleted_at IS NULL').get(lead.id);
  if (existingByLead) throw conflict('This lead has already been converted to a customer');

  const b = req.body;
  const name = b.name ?? lead.company_name;
  const emailVal = b.email ?? lead.email ?? null;
  const mobileVal = b.mobile ?? lead.mobile ?? null;
  const dup = findCustomerDuplicate(db, companyId, { name, email: emailVal, mobile: mobileVal, gst: b.gst ?? null });
  if (dup) throw conflict(`A customer already exists for this ${dup}`);

  const { teamIdVal, assignedToVal } = resolveCustomerAssignment(db, req, scope, companyId, {
    assignedTo: b.assignedTo ?? lead.assigned_to,
    teamId: b.teamId ?? lead.team_id,
  });

  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        `INSERT INTO customers (company_id, name, contact_person, mobile, whatsapp, email, address, city, state,
                                gst, pan, customer_type, status, assigned_to, team_id, lead_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        companyId,
        name,
        b.contactPerson ?? lead.contact_person ?? null,
        mobileVal,
        b.whatsapp ?? lead.whatsapp ?? null,
        emailVal,
        b.address ?? lead.address ?? null,
        b.city ?? lead.city ?? null,
        b.state ?? lead.state ?? null,
        b.gst ?? null,
        b.pan ?? null,
        b.customerType ?? 'Company',
        b.status ?? 'Active',
        assignedToVal,
        teamIdVal,
        lead.id,
        req.user.id
      );
    const customerId = Number(info.lastInsertRowid);
    const customerNo = `CUST-${String(customerId).padStart(6, '0')}`;
    db.prepare('UPDATE customers SET customer_no = ? WHERE id = ?').run(customerNo, customerId);

    insertCustomerActivity(db, {
      customerId,
      userId: req.user.id,
      type: 'converted',
      description: `Converted from lead ${lead.lead_no}`,
      metadata: { leadId: lead.id, leadNo: lead.lead_no },
    });

    // Preserve lead history: mark the lead won and record the conversion.
    if (lead.status !== 'Won') {
      db.prepare("UPDATE leads SET status = 'Won', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(lead.id);
    }
    db.prepare(
      `INSERT INTO lead_activities (lead_id, user_id, type, description, metadata)
       VALUES (?, ?, 'converted', ?, ?)`
    ).run(lead.id, req.user.id, `Converted to customer ${customerNo}`, JSON.stringify({ customerId, customerNo }));

    db.exec('COMMIT');

    req.audit?.('customer.convert', { entityType: 'customer', entityId: customerId, metadata: { leadId: lead.id, leadNo: lead.lead_no } });

    const row = db.prepare(`${CUSTOMER_SELECT} WHERE c.id = ?`).get(customerId);
    return created(res, customerToJson(row));
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Import / Export
// ---------------------------------------------------------------------------

export const importCustomers = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const companyId = req.user.isSuperAdmin ? req.body.companyId ?? null : req.user.companyId;
  if (!companyId) throw badRequest('A target company is required to import customers');

  const { format, data } = req.body;
  let rows;
  try {
    const buffer = format === 'xlsx' ? base64ToBuffer(data) : Buffer.from(String(data), 'utf8');
    rows = customerBufferToRows(buffer, { format: format === 'xlsx' ? 'xlsx' : 'csv' });
  } catch {
    throw badRequest('Unable to parse the uploaded file');
  }

  if (!rows.length || rows.length < 2) throw badRequest('The file must contain a header row and at least one data row');
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw badRequest(`Import exceeds the maximum of ${MAX_IMPORT_ROWS} data rows`);

  const { map } = buildCustomerHeaderMap(rows[0]);
  if (map.name === undefined) {
    throw badRequest('The file must contain a "Company/Name" (or equivalent) column');
  }

  const existingKeys = new Set();
  const existing = db
    .prepare('SELECT name, email, mobile, gst FROM customers WHERE company_id = ? AND deleted_at IS NULL')
    .all(companyId);
  for (const e of existing) {
    for (const k of customerDuplicateKeys(e)) existingKeys.add(k);
  }

  const seenKeys = new Set();
  const report = { total: rows.length - 1, imported: 0, duplicates: [], errors: [] };

  const emailToUser = db.prepare('SELECT id, company_id, team_id FROM users WHERE company_id = ? AND email = ?');

  db.exec('BEGIN');
  try {
    for (let i = 1; i < rows.length; i += 1) {
      const rowNumber = i + 1;
      const { row, errors } = normalizeCustomerRow(map, rows[i]);
      if (errors.length) {
        report.errors.push({ row: rowNumber, message: errors.join('; ') });
        continue;
      }

      const keys = customerDuplicateKeys(row);
      if (keys.some((k) => existingKeys.has(k) || seenKeys.has(k))) {
        report.duplicates.push({ row: rowNumber, message: 'Duplicate customer (name + email/mobile/GST already exists)' });
        continue;
      }
      keys.forEach((k) => seenKeys.add(k));

      let assignedToVal = req.user.isSuperAdmin ? null : req.user.id;
      if (row.assignedTo) {
        const user = emailToUser.get(companyId, String(row.assignedTo).toLowerCase().trim());
        if (!user) {
          report.errors.push({ row: rowNumber, message: `Assigned user not found: ${row.assignedTo}` });
          continue;
        }
        if (!canAssignCustomerTo(scope, user)) {
          report.errors.push({ row: rowNumber, message: `You cannot assign customers to ${row.assignedTo}` });
          continue;
        }
        assignedToVal = user.id;
      }

      const info = db
        .prepare(
          `INSERT INTO customers (company_id, name, contact_person, mobile, whatsapp, email, address, city, state,
                                  gst, pan, customer_type, status, assigned_to, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          companyId,
          row.name,
          row.contactPerson ?? null,
          row.mobile ?? null,
          row.whatsapp ?? null,
          row.email ?? null,
          row.address ?? null,
          row.city ?? null,
          row.state ?? null,
          row.gst ?? null,
          row.pan ?? null,
          row.customerType ?? 'Company',
          row.status ?? 'Active',
          assignedToVal,
          req.user.id
        );
      const customerId = Number(info.lastInsertRowid);
      db.prepare('UPDATE customers SET customer_no = ? WHERE id = ?').run(`CUST-${String(customerId).padStart(6, '0')}`, customerId);
      insertCustomerActivity(db, { customerId, userId: req.user.id, type: 'created', description: 'Customer imported' });
      report.imported += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  req.audit?.('customer.import', { entityType: 'customer', metadata: { companyId, imported: report.imported } });

  return ok(res, report);
});

export const exportCustomers = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const { search, status, customerType, assignedTo, teamId, format } = req.query;

  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(c.customer_no LIKE ? OR c.name LIKE ? OR c.contact_person LIKE ? OR c.mobile LIKE ? OR c.email LIKE ? OR c.gst LIKE ? OR c.pan LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like);
  }
  if (status) {
    clauses.push('c.status = ?');
    params.push(status);
  }
  if (customerType) {
    clauses.push('c.customer_type = ?');
    params.push(customerType);
  }
  if (assignedTo) {
    clauses.push('c.assigned_to = ?');
    params.push(assignedTo);
  }
  if (teamId) {
    clauses.push('c.team_id = ?');
    params.push(teamId);
  }

  const { where, params: whereParams } = scopedCustomerWhere(scope, clauses, params, 'c');
  const rows = db.prepare(`${CUSTOMER_SELECT} ${where} ORDER BY c.id DESC LIMIT 100000`).all(...whereParams);
  const customers = rows.map((r) => {
    const c = customerToJson(r);
    return { ...c, createdAt: c.createdAt?.slice(0, 10) };
  });

  req.audit?.('customer.export', { entityType: 'customer', metadata: { count: customers.length } });

  if (format === 'xlsx') {
    const buffer = customersToXlsx(customers);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="customers.xlsx"');
    return res.send(buffer);
  }

  const csv = customersToCsv(customers);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
  return res.send(csv);
});
