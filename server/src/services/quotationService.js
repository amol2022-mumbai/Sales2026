// ============================================================================
// Quotations (customer proposals with product line items). Every query is
// scoped to the acting user's company via `access.js`; `company_id` is always
// derived from the authenticated context, never from client input. Totals are
// recomputed from line items on every write — never stored out of band.
// ============================================================================

import { getDb } from '../db/connection.js';
import { notFound, forbidden, badRequest } from '../lib/httpError.js';
import { buildQuotationScopeWhere, canAccessQuotation } from './access.js';

export const QUOTATION_STATUSES = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Cancelled'];

const QUOTATION_SELECT = `
  SELECT q.*, c.name AS customer_name, c.customer_no AS customer_no,
         u.name AS assigned_name, t.name AS team_name
  FROM quotations q
  JOIN customers c ON c.id = q.customer_id
  LEFT JOIN users u ON u.id = q.assigned_to
  LEFT JOIN teams t ON t.id = q.team_id
`;

const ITEM_SELECT = `
  SELECT i.*, p.name AS product_name, p.sku AS product_sku
  FROM quotation_items i
  LEFT JOIN products p ON p.id = i.product_id
`;

const SORTABLE = {
  quotationNo: 'q.quotation_no',
  total: 'q.total',
  status: 'q.status',
  customerName: 'c.name',
  createdAt: 'q.created_at',
};

function pad6(n) {
  return String(n).padStart(6, '0');
}

export function quotationNo(id) {
  return `QTN-${pad6(id)}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function itemToJson(i) {
  return {
    id: i.id,
    productId: i.product_id,
    productName: i.product_name || null,
    productSku: i.product_sku || null,
    name: i.name,
    unit: i.unit || null,
    quantity: i.quantity,
    unitPrice: i.unit_price,
    taxRate: i.tax_rate,
    amount: i.amount,
  };
}

function isExpired(row) {
  if (row.status !== 'Sent' || !row.valid_until) return false;
  return row.valid_until < new Date().toISOString().slice(0, 10);
}

function quotationToJson(db, row) {
  const items = db.prepare(`${ITEM_SELECT} WHERE i.quotation_id = ? ORDER BY i.id ASC`).all(row.id);
  return {
    id: row.id,
    quotationNo: row.quotation_no,
    companyId: row.company_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerNo: row.customer_no,
    opportunityId: row.opportunity_id,
    status: row.status,
    expired: isExpired(row),
    validUntil: row.valid_until,
    subtotal: row.subtotal,
    taxAmount: row.tax_amount,
    discount: row.discount,
    total: row.total,
    assignedTo: row.assigned_to,
    assignedName: row.assigned_name || null,
    teamId: row.team_id,
    teamName: row.team_name || null,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map(itemToJson),
  };
}

/**
 * Validate + normalize line items, snapshotting product fields when a
 * `productId` is supplied. Returns DB-ready rows with `amount` computed.
 */
function resolveItems(db, companyId, items) {
  return items.map((it) => {
    let name = it.name;
    let unit = it.unit ?? null;
    let unitPrice = it.unitPrice ?? 0;
    let taxRate = it.taxRate ?? 0;

    if (it.productId != null) {
      const p = db
        .prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL')
        .get(it.productId);
      if (!p) throw badRequest('A line item references a product that does not exist');
      if (p.company_id !== companyId) {
        throw forbidden('A line item references a product that does not belong to this company');
      }
      name = p.name;
      unit = it.unit ?? p.unit ?? null;
      unitPrice = p.unit_price;
      taxRate = p.tax_rate;
    }

    const quantity = it.quantity;
    const amount = round2(quantity * unitPrice);
    return { productId: it.productId ?? null, name, unit, quantity, unitPrice, taxRate, amount };
  });
}

function computeTotals(items, discount) {
  const subtotal = round2(items.reduce((s, i) => s + i.amount, 0));
  const taxAmount = round2(items.reduce((s, i) => s + (i.amount * i.taxRate) / 100, 0));
  const total = round2(subtotal + taxAmount - discount);
  return { subtotal, taxAmount, total };
}

function rowById(id) {
  return getDb().prepare(`${QUOTATION_SELECT} WHERE q.id = ?`).get(id);
}

/**
 * List quotations scoped to the acting user's data scope.
 */
export function listQuotations(scope, query) {
  const db = getDb();
  const {
    page, pageSize, search, status, customerId, assignedTo, teamId, dateFrom, dateTo, sort, order,
  } = query;

  const { where, params } = buildQuotationScopeWhere(scope, 'q');
  const clauses = [where.replace(/^WHERE\s+/, '')].filter(Boolean);
  const allParams = [...params];

  if (search) {
    clauses.push('(q.quotation_no LIKE ? OR c.name LIKE ? OR c.customer_no LIKE ?)');
    const like = `%${search}%`;
    allParams.push(like, like, like);
  }
  if (status === 'Expired') {
    clauses.push("q.status = 'Sent' AND q.valid_until IS NOT NULL AND q.valid_until < date('now')");
  } else if (status) {
    clauses.push('q.status = ?');
    allParams.push(status);
  }
  if (customerId) {
    clauses.push('q.customer_id = ?');
    allParams.push(customerId);
  }
  if (assignedTo) {
    clauses.push('q.assigned_to = ?');
    allParams.push(assignedTo);
  }
  if (teamId) {
    clauses.push('q.team_id = ?');
    allParams.push(teamId);
  }
  if (dateFrom) {
    clauses.push('date(q.created_at) >= ?');
    allParams.push(dateFrom);
  }
  if (dateTo) {
    clauses.push('date(q.created_at) <= ?');
    allParams.push(dateTo);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM quotations q JOIN customers c ON c.id = q.customer_id ${whereSql}`)
    .get(...allParams).c;

  const sortCol = SORTABLE[sort] || 'q.created_at';
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  const rows = db
    .prepare(`${QUOTATION_SELECT} ${whereSql} ORDER BY ${sortCol} ${dir}, q.id DESC LIMIT ? OFFSET ?`)
    .all(...allParams, pageSize, (page - 1) * pageSize);

  return { data: rows.map((r) => quotationToJson(db, r)), total };
}

/**
 * Fetch a single quotation within the acting user's scope.
 */
export function getQuotation(scope, id) {
  const db = getDb();
  const row = rowById(id);
  if (!row || row.deleted_at) throw notFound('Quotation not found');
  if (!canAccessQuotation(scope, row)) throw forbidden('You cannot access this quotation');
  return quotationToJson(db, row);
}

function assertCustomerInCompany(db, customerId, companyId) {
  const customer = db
    .prepare('SELECT id, company_id FROM customers WHERE id = ? AND deleted_at IS NULL')
    .get(customerId);
  if (!customer || customer.company_id !== companyId) throw notFound('Customer not found');
}

function assertOpportunityInCompany(db, opportunityId, companyId) {
  if (opportunityId == null) return null;
  const opp = db
    .prepare('SELECT id, company_id FROM opportunities WHERE id = ? AND deleted_at IS NULL')
    .get(opportunityId);
  if (!opp || opp.company_id !== companyId) throw badRequest('Opportunity does not belong to this company');
  return opportunityId;
}

function assertAssignee(db, companyId, assignedTo, teamId) {
  if (assignedTo != null) {
    const u = db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(assignedTo, companyId);
    if (!u) throw badRequest('Assigned salesperson does not belong to this company');
  }
  if (teamId != null) {
    const t = db.prepare('SELECT id FROM teams WHERE id = ? AND company_id = ?').get(teamId, companyId);
    if (!t) throw badRequest('Team does not belong to this company');
  }
}

/**
 * Create a quotation for `companyId` (already derived from the authenticated
 * context). Validates customer/opportunity/assignee ownership, snapshots line
 * items from the product catalogue, and recomputes totals.
 */
export function createQuotation(scope, companyId, data, userId) {
  const db = getDb();
  if (!companyId) throw badRequest('A company is required to create a quotation');

  assertCustomerInCompany(db, data.customerId, companyId);
  assertOpportunityInCompany(db, data.opportunityId, companyId);
  assertAssignee(db, companyId, data.assignedTo, data.teamId);

  let assignedTo = data.assignedTo ?? null;
  let teamId = data.teamId ?? null;
  if (assignedTo == null && teamId == null && scope.type === 'self') {
    assignedTo = userId;
  }

  const items = resolveItems(db, companyId, data.items);
  const totals = computeTotals(items, data.discount ?? 0);

  const info = db
    .prepare(
      `INSERT INTO quotations (company_id, customer_id, opportunity_id, status, valid_until,
                               subtotal, tax_amount, discount, total, assigned_to, team_id, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      companyId,
      data.customerId,
      data.opportunityId ?? null,
      data.status ?? 'Draft',
      data.validUntil ?? null,
      totals.subtotal,
      totals.taxAmount,
      data.discount ?? 0,
      totals.total,
      assignedTo,
      teamId,
      data.notes ?? null,
      userId ?? null
    );
  const quotationId = Number(info.lastInsertRowid);
  db.prepare('UPDATE quotations SET quotation_no = ? WHERE id = ?').run(quotationNo(quotationId), quotationId);

  const insertItem = db.prepare(
    `INSERT INTO quotation_items (quotation_id, product_id, name, unit, quantity, unit_price, tax_rate, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const it of items) {
    insertItem.run(quotationId, it.productId, it.name, it.unit, it.quantity, it.unitPrice, it.taxRate, it.amount);
  }

  return quotationToJson(db, rowById(quotationId));
}

/**
 * Update a quotation (partial) within the acting user's scope. When `items`
 * are supplied, line items are replaced and totals recomputed.
 */
export function updateQuotation(scope, id, data) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM quotations WHERE id = ?').get(id);
  if (!row || row.deleted_at) throw notFound('Quotation not found');
  if (!canAccessQuotation(scope, row)) throw forbidden('You cannot modify this quotation');

  if (data.assignedTo !== undefined && data.assignedTo != null) {
    const u = db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(data.assignedTo, row.company_id);
    if (!u) throw badRequest('Assigned salesperson does not belong to this company');
  }
  if (data.teamId !== undefined && data.teamId != null) {
    const t = db.prepare('SELECT id FROM teams WHERE id = ? AND company_id = ?').get(data.teamId, row.company_id);
    if (!t) throw badRequest('Team does not belong to this company');
  }
  if (data.opportunityId !== undefined) {
    assertOpportunityInCompany(db, data.opportunityId, row.company_id);
  }

  const sets = [];
  const values = [];
  const fieldMap = {
    status: 'status',
    validUntil: 'valid_until',
    discount: 'discount',
    assignedTo: 'assigned_to',
    teamId: 'team_id',
    notes: 'notes',
    opportunityId: 'opportunity_id',
  };
  for (const [input, column] of Object.entries(fieldMap)) {
    if (data[input] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(data[input]);
    }
  }

  if (data.items !== undefined) {
    const items = resolveItems(db, row.company_id, data.items);
    const totals = computeTotals(items, data.discount ?? row.discount ?? 0);
    sets.push('subtotal = ?', 'tax_amount = ?', 'total = ?');
    values.push(totals.subtotal, totals.taxAmount, totals.total);
    db.prepare('DELETE FROM quotation_items WHERE quotation_id = ?').run(row.id);
    const insertItem = db.prepare(
      `INSERT INTO quotation_items (quotation_id, product_id, name, unit, quantity, unit_price, tax_rate, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const it of items) {
      insertItem.run(row.id, it.productId, it.name, it.unit, it.quantity, it.unitPrice, it.taxRate, it.amount);
    }
  } else if (data.discount !== undefined) {
    const items = db
      .prepare('SELECT * FROM quotation_items WHERE quotation_id = ?')
      .all(row.id)
      .map((r) => ({ amount: r.amount, taxRate: r.tax_rate }));
    const totals = computeTotals(items, data.discount);
    sets.push('subtotal = ?', 'tax_amount = ?', 'total = ?');
    values.push(totals.subtotal, totals.taxAmount, totals.total);
  }

  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(row.id);
    db.prepare(`UPDATE quotations SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  return quotationToJson(db, rowById(row.id));
}

/**
 * Soft-delete a quotation within the acting user's scope.
 */
export function deleteQuotation(scope, id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM quotations WHERE id = ?').get(id);
  if (!row || row.deleted_at) throw notFound('Quotation not found');
  if (!canAccessQuotation(scope, row)) throw forbidden('You cannot delete this quotation');

  db.prepare(
    "UPDATE quotations SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  ).run(row.id);

  return { id: row.id, deleted: true };
}
