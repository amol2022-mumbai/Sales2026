import { getDb } from '../db/connection.js';
import { notFound, forbidden, badRequest, conflict } from '../lib/httpError.js';
import { ok, created, paginated } from '../lib/response.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getUserDataScope, buildInvoiceScopeWhere, buildPaymentScopeWhere, canAccessInvoice } from '../services/access.js';
import { invoiceNo, paymentNo, invoicePaid, invoicePaidByInvoiceIds, deriveInvoiceStatus, recomputeInvoiceStatus, isOverdue } from '../services/collectionService.js';

const INVOICE_SELECT = `
  SELECT i.*, c.name AS customer_name, c.customer_no AS customer_no,
         u.name AS assigned_name, t.name AS team_name
  FROM invoices i
  JOIN customers c ON c.id = i.customer_id
  LEFT JOIN users u ON u.id = i.assigned_to
  LEFT JOIN teams t ON t.id = i.team_id
`;

const PAYMENT_SELECT = `
  SELECT p.*, c.name AS customer_name, c.customer_no AS customer_no,
         i.invoice_no, u.name AS received_by_name
  FROM payments p
  JOIN invoices i ON i.id = p.invoice_id
  JOIN customers c ON c.id = p.customer_id
  LEFT JOIN users u ON u.id = p.received_by
`;

function invoiceToJson(db, row, paidOverride) {
  const paid = paidOverride !== undefined ? paidOverride : invoicePaid(db, row.id);
  const balance = Math.round((row.amount - paid) * 100) / 100;
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerNo: row.customer_no,
    amount: row.amount,
    paid: Math.round(paid * 100) / 100,
    balance,
    dueDate: row.due_date,
    status: row.status,
    overdue: isOverdue(row, balance),
    assignedTo: row.assigned_to,
    assignedName: row.assigned_name || null,
    teamId: row.team_id,
    teamName: row.team_name || null,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function paymentToJson(row) {
  return {
    id: row.id,
    paymentNo: row.payment_no,
    invoiceId: row.invoice_id,
    invoiceNo: row.invoice_no,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerNo: row.customer_no,
    amount: row.amount,
    paymentDate: row.payment_date,
    method: row.method,
    reference: row.reference,
    receivedBy: row.received_by,
    receivedByName: row.received_by_name || null,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function resolveCompany(req) {
  const companyId = req.user.isSuperAdmin ? (req.body.companyId ?? null) : req.user.companyId;
  if (!companyId) throw badRequest('A target company is required');
  return companyId;
}

function assertCustomerInCompany(db, customerId, companyId) {
  const customer = db
    .prepare('SELECT id, company_id, team_id, assigned_to FROM customers WHERE id = ? AND deleted_at IS NULL')
    .get(customerId);
  if (!customer) throw notFound('Customer not found');
  if (customer.company_id !== companyId) throw notFound('Customer not found');
  return customer;
}

export const listInvoices = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const { page, pageSize, search, status, customerId, assignedTo, teamId, dateFrom, dateTo, sort, order } = req.query;

  const { where, params } = buildInvoiceScopeWhere(scope, 'i');
  const clauses = [where.replace(/^WHERE\s+/, '')].filter(Boolean);
  const allParams = [...params];

  if (search) {
    clauses.push('(i.invoice_no LIKE ? OR c.name LIKE ? OR c.customer_no LIKE ?)');
    const like = `%${search}%`;
    allParams.push(like, like, like);
  }
  if (status === 'Overdue') {
    clauses.push(
      `i.due_date IS NOT NULL AND date(i.due_date) < date('now') AND (i.amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.deleted_at IS NULL), 0)) > 0`
    );
  } else if (status) {
    clauses.push('i.status = ?');
    allParams.push(status);
  }
  if (customerId) {
    clauses.push('i.customer_id = ?');
    allParams.push(customerId);
  }
  if (assignedTo) {
    clauses.push('i.assigned_to = ?');
    allParams.push(assignedTo);
  }
  if (teamId) {
    clauses.push('i.team_id = ?');
    allParams.push(teamId);
  }
  if (dateFrom) {
    clauses.push('date(i.created_at) >= ?');
    allParams.push(dateFrom);
  }
  if (dateTo) {
    clauses.push('date(i.created_at) <= ?');
    allParams.push(dateTo);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM invoices i JOIN customers c ON c.id = i.customer_id ${whereSql}`).get(...allParams).c;
  const sortCol = {
    invoiceNo: 'i.invoice_no',
    amount: 'i.amount',
    dueDate: 'i.due_date',
    status: 'i.status',
    customerName: 'c.name',
    createdAt: 'i.created_at',
  }[sort] || 'i.created_at';
  const dir = order === 'asc' ? 'ASC' : 'DESC';

  const rows = db
    .prepare(`${INVOICE_SELECT} ${whereSql} ORDER BY ${sortCol} ${dir} LIMIT ? OFFSET ?`)
    .all(...allParams, pageSize, (page - 1) * pageSize);

  const paidById = invoicePaidByInvoiceIds(db, rows.map((r) => r.id));
  const items = rows.map((r) => invoiceToJson(db, r, paidById.get(r.id) ?? 0));

  return paginated(res, items, { page, pageSize, total });
});

export const getInvoice = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const row = db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Invoice not found');
  if (!canAccessInvoice(scope, row)) throw forbidden('You cannot access this invoice');

  const payments = db
    .prepare(`${PAYMENT_SELECT} WHERE p.invoice_id = ? AND p.deleted_at IS NULL ORDER BY p.payment_date DESC, p.id DESC`)
    .all(row.id)
    .map(paymentToJson);

  return ok(res, { ...invoiceToJson(db, row), payments });
});

export const createInvoice = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const companyId = resolveCompany(req);

  assertCustomerInCompany(db, req.body.customerId, companyId);

  let teamId = req.body.teamId ?? null;
  let assignedTo = req.body.assignedTo ?? null;
  if (assignedTo != null) {
    const u = db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(assignedTo, companyId);
    if (!u) throw badRequest('Assigned salesperson does not belong to this company');
  }
  if (teamId != null) {
    const t = db.prepare('SELECT id FROM teams WHERE id = ? AND company_id = ?').get(teamId, companyId);
    if (!t) throw badRequest('Team does not belong to this company');
  }
  if (assignedTo == null && teamId == null && scope.type === 'self') {
    assignedTo = req.user.id;
  }

  const result = db
    .prepare(
      `INSERT INTO invoices (company_id, customer_id, amount, due_date, status, assigned_to, team_id, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(companyId, req.body.customerId, req.body.amount, req.body.dueDate ?? null, req.body.status ?? 'Unpaid', assignedTo, teamId, req.body.notes ?? null, req.user.id);

  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE invoices SET invoice_no = ? WHERE id = ?').run(invoiceNo(id), id);
  recomputeInvoiceStatus(db, id);

  req.audit?.('invoice.create', { entityType: 'invoice', entityId: id, metadata: { companyId, customerId: req.body.customerId } });

  const row = db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(id);
  return created(res, invoiceToJson(db, row));
});

export const updateInvoice = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Invoice not found');
  if (!canAccessInvoice(scope, row)) throw forbidden('You cannot modify this invoice');

  const sets = [];
  const values = [];
  const fields = { amount: 'amount', dueDate: 'due_date', status: 'status', notes: 'notes', assignedTo: 'assigned_to', teamId: 'team_id' };
  for (const [input, column] of Object.entries(fields)) {
    if (req.body[input] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(req.body[input]);
    }
  }

  if (req.body.assignedTo != null) {
    const u = db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(req.body.assignedTo, row.company_id);
    if (!u) throw badRequest('Assigned salesperson does not belong to this company');
  }
  if (req.body.teamId != null) {
    const t = db.prepare('SELECT id FROM teams WHERE id = ? AND company_id = ?').get(req.body.teamId, row.company_id);
    if (!t) throw badRequest('Team does not belong to this company');
  }

  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(row.id);
    db.prepare(`UPDATE invoices SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    recomputeInvoiceStatus(db, row.id);
  }

  req.audit?.('invoice.update', { entityType: 'invoice', entityId: row.id });

  const updated = db.prepare(`${INVOICE_SELECT} WHERE i.id = ?`).get(row.id);
  return ok(res, invoiceToJson(db, updated));
});

export const deleteInvoice = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Invoice not found');
  if (!canAccessInvoice(scope, row)) throw forbidden('You cannot delete this invoice');

  db.prepare("UPDATE invoices SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);
  req.audit?.('invoice.delete', { entityType: 'invoice', entityId: row.id, metadata: { invoiceNo: row.invoice_no } });
  return ok(res, { deleted: true });
});

export const listPayments = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const { page, pageSize, invoiceId, customerId, dateFrom, dateTo, sort, order } = req.query;

  const { where, params } = buildPaymentScopeWhere(scope, 'p');
  const clauses = [where.replace(/^WHERE\s+/, '')].filter(Boolean);
  const allParams = [...params];
  if (invoiceId) {
    clauses.push('p.invoice_id = ?');
    allParams.push(invoiceId);
  }
  if (customerId) {
    clauses.push('p.customer_id = ?');
    allParams.push(customerId);
  }
  if (dateFrom) {
    clauses.push('p.payment_date >= ?');
    allParams.push(dateFrom);
  }
  if (dateTo) {
    clauses.push('p.payment_date <= ?');
    allParams.push(dateTo);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = p.customer_id ${whereSql}`)
    .get(...allParams).c;
  const sortCol = { paymentNo: 'p.payment_no', amount: 'p.amount', paymentDate: 'p.payment_date', method: 'p.method' }[sort] || 'p.payment_date';
  const dir = order === 'asc' ? 'ASC' : 'DESC';

  const rows = db
    .prepare(`${PAYMENT_SELECT} ${whereSql} ORDER BY ${sortCol} ${dir} LIMIT ? OFFSET ?`)
    .all(...allParams, pageSize, (page - 1) * pageSize);

  return paginated(res, rows.map(paymentToJson), { page, pageSize, total });
});

export const recordPayment = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const companyId = resolveCompany(req);

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.body.invoiceId);
  if (!invoice || invoice.deleted_at) throw notFound('Invoice not found');
  if (!canAccessInvoice(scope, invoice)) throw forbidden('You cannot record a payment on this invoice');

  const customer = db.prepare('SELECT id, company_id FROM customers WHERE id = ? AND deleted_at IS NULL').get(invoice.customer_id);
  if (!customer || customer.company_id !== companyId) throw notFound('Customer not found');

  const result = db
    .prepare(
      `INSERT INTO payments (company_id, invoice_id, customer_id, amount, payment_date, method, reference, notes, received_by, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(companyId, invoice.id, customer.id, req.body.amount, req.body.paymentDate, req.body.method ?? 'Bank Transfer', req.body.reference ?? null, req.body.notes ?? null, req.user.id, req.user.id);

  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE payments SET payment_no = ? WHERE id = ?').run(paymentNo(id), id);
  recomputeInvoiceStatus(db, invoice.id);

  req.audit?.('payment.create', { entityType: 'payment', entityId: id, metadata: { invoiceId: invoice.id, amount: req.body.amount } });

  const row = db.prepare(`${PAYMENT_SELECT} WHERE p.id = ?`).get(id);
  return created(res, paymentToJson(row));
});

export const deletePayment = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!row || row.deleted_at) throw notFound('Payment not found');

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(row.invoice_id);
  if (!invoice || !canAccessInvoice(scope, invoice)) throw forbidden('You cannot delete this payment');

  db.prepare("UPDATE payments SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);
  recomputeInvoiceStatus(db, invoice.id);
  req.audit?.('payment.delete', { entityType: 'payment', entityId: row.id, metadata: { invoiceId: invoice.id } });
  return ok(res, { deleted: true });
});

export const collectionsDashboard = asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = getUserDataScope(req.user);
  const { where, params } = buildInvoiceScopeWhere(scope, 'i');

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(i.amount), 0) AS invoiced,
         COUNT(*) AS invoice_count
       FROM invoices i ${where} AND i.deleted_at IS NULL`
    )
    .get(...params);

  const paid = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS v
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       ${where} AND p.deleted_at IS NULL`
    )
    .get(...params);

  const invoiced = Math.round(totals.invoiced * 100) / 100;
  const collected = Math.round(paid.v * 100) / 100;
  const outstanding = Math.round((invoiced - collected) * 100) / 100;

  const agingRows = db
    .prepare(
      `SELECT
         CASE
           WHEN i.due_date >= date('now') THEN 'Not due'
           WHEN i.due_date >= date('now', '-30 days') THEN '1-30 days'
           WHEN i.due_date >= date('now', '-60 days') THEN '31-60 days'
           WHEN i.due_date >= date('now', '-90 days') THEN '61-90 days'
           ELSE '90+ days'
         END AS bucket,
         SUM(i.amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id AND p.deleted_at IS NULL), 0)) AS balance
       FROM invoices i
       ${where} AND i.deleted_at IS NULL
       GROUP BY bucket`
    )
    .all(...params);

  const aging = [
    { bucket: 'Not due', amount: 0 },
    { bucket: '1-30 days', amount: 0 },
    { bucket: '31-60 days', amount: 0 },
    { bucket: '61-90 days', amount: 0 },
    { bucket: '90+ days', amount: 0 },
  ];
  for (const r of agingRows) {
    const slot = aging.find((a) => a.bucket === r.bucket);
    if (slot) slot.amount = Math.max(0, Math.round(r.balance * 100) / 100);
  }

  return ok(res, {
    invoiced,
    collected,
    outstanding,
    invoiceCount: totals.invoice_count,
    aging,
  });
});
