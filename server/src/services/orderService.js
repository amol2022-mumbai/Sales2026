// ============================================================================
// Sales Orders (fulfilled work orders with product line items). Every query is
// scoped to the acting user's company via `access.js`; `company_id` is always
// derived from the authenticated context, never from client input. Totals are
// recomputed from line items on every write — never stored out of band.
// Orders can be created directly or converted from an accepted quotation.
// ============================================================================

import { getDb } from '../db/connection.js';
import { notFound, forbidden, badRequest, conflict } from '../lib/httpError.js';
import { buildOrderScopeWhere, canAccessOrder, canAccessQuotation } from './access.js';

export const ORDER_STATUSES = ['Draft', 'Confirmed', 'Processing', 'Completed', 'Cancelled'];

// Accepted limitation: status transitions are intentionally NOT enforced. The
// intended lifecycle is Draft -> Confirmed -> Processing -> Completed/Cancelled,
// but any of the five states may be set directly on create/update, matching the
// free-form status handling used by quotations and invoices. The DB CHECK
// constraint and Zod enum still restrict values to this closed set.


const ORDER_SELECT = `
  SELECT o.*, c.name AS customer_name, c.customer_no AS customer_no,
         u.name AS assigned_name, t.name AS team_name,
         q.quotation_no AS quotation_no
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN users u ON u.id = o.assigned_to
  LEFT JOIN teams t ON t.id = o.team_id
  LEFT JOIN quotations q ON q.id = o.quotation_id
`;

const ITEM_SELECT = `
  SELECT i.*, p.name AS product_name, p.sku AS product_sku
  FROM order_items i
  LEFT JOIN products p ON p.id = i.product_id
`;

const SORTABLE = {
  orderNo: 'o.order_no',
  total: 'o.total',
  status: 'o.status',
  customerName: 'c.name',
  createdAt: 'o.created_at',
};

function pad6(n) {
  return String(n).padStart(6, '0');
}

export function orderNo(id) {
  return `ORD-${pad6(id)}`;
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

function orderToJson(db, row) {
  const items = db.prepare(`${ITEM_SELECT} WHERE i.order_id = ? ORDER BY i.id ASC`).all(row.id);
  return {
    id: row.id,
    orderNo: row.order_no,
    companyId: row.company_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerNo: row.customer_no,
    quotationId: row.quotation_id,
    quotationNo: row.quotation_no || null,
    status: row.status,
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
  return getDb().prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id);
}

function assertCustomerInCompany(db, customerId, companyId) {
  const customer = db
    .prepare('SELECT id, company_id FROM customers WHERE id = ? AND deleted_at IS NULL')
    .get(customerId);
  if (!customer || customer.company_id !== companyId) throw notFound('Customer not found');
  return customer;
}

function assertQuotationInCompany(db, quotationId, companyId) {
  if (quotationId == null) return null;
  const quotation = db
    .prepare('SELECT id, company_id FROM quotations WHERE id = ? AND deleted_at IS NULL')
    .get(quotationId);
  if (!quotation || quotation.company_id !== companyId) throw badRequest('Quotation does not belong to this company');
  return quotation;
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

function persistItems(db, orderId, items) {
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, name, unit, quantity, unit_price, tax_rate, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const it of items) {
    insertItem.run(orderId, it.productId, it.name, it.unit, it.quantity, it.unitPrice, it.taxRate, it.amount);
  }
}

/**
 * List orders scoped to the acting user's data scope.
 */
export function listOrders(scope, query) {
  const db = getDb();
  const {
    page, pageSize, search, status, customerId, quotationId, assignedTo, teamId, dateFrom, dateTo, sort, order,
  } = query;

  const { where, params } = buildOrderScopeWhere(scope, 'o');
  const clauses = [where.replace(/^WHERE\s+/, '')].filter(Boolean);
  const allParams = [...params];

  if (search) {
    clauses.push('(o.order_no LIKE ? OR c.name LIKE ? OR c.customer_no LIKE ?)');
    const like = `%${search}%`;
    allParams.push(like, like, like);
  }
  if (status) {
    clauses.push('o.status = ?');
    allParams.push(status);
  }
  if (customerId) {
    clauses.push('o.customer_id = ?');
    allParams.push(customerId);
  }
  if (quotationId) {
    clauses.push('o.quotation_id = ?');
    allParams.push(quotationId);
  }
  if (assignedTo) {
    clauses.push('o.assigned_to = ?');
    allParams.push(assignedTo);
  }
  if (teamId) {
    clauses.push('o.team_id = ?');
    allParams.push(teamId);
  }
  if (dateFrom) {
    clauses.push('date(o.created_at) >= ?');
    allParams.push(dateFrom);
  }
  if (dateTo) {
    clauses.push('date(o.created_at) <= ?');
    allParams.push(dateTo);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM orders o JOIN customers c ON c.id = o.customer_id ${whereSql}`)
    .get(...allParams).c;

  const sortCol = SORTABLE[sort] || 'o.created_at';
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  const rows = db
    .prepare(`${ORDER_SELECT} ${whereSql} ORDER BY ${sortCol} ${dir}, o.id DESC LIMIT ? OFFSET ?`)
    .all(...allParams, pageSize, (page - 1) * pageSize);

  return { data: rows.map((r) => orderToJson(db, r)), total };
}

/**
 * Fetch a single order within the acting user's scope.
 */
export function getOrder(scope, id) {
  const db = getDb();
  const row = rowById(id);
  if (!row || row.deleted_at) throw notFound('Order not found');
  if (!canAccessOrder(scope, row)) throw forbidden('You cannot access this order');
  return orderToJson(db, row);
}

/**
 * Create an order for `companyId` (already derived from the authenticated
 * context). Validates customer/quotation/assignee ownership, snapshots line
 * items from the product catalogue, and recomputes totals.
 */
export function createOrder(scope, companyId, data, userId) {
  const db = getDb();
  if (!companyId) throw badRequest('A company is required to create an order');

  assertCustomerInCompany(db, data.customerId, companyId);
  assertQuotationInCompany(db, data.quotationId, companyId);
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
      `INSERT INTO orders (company_id, customer_id, quotation_id, status, subtotal, tax_amount, discount, total, assigned_to, team_id, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      companyId,
      data.customerId,
      data.quotationId ?? null,
      data.status ?? 'Draft',
      totals.subtotal,
      totals.taxAmount,
      data.discount ?? 0,
      totals.total,
      assignedTo,
      teamId,
      data.notes ?? null,
      userId ?? null
    );
  const orderId = Number(info.lastInsertRowid);
  db.prepare('UPDATE orders SET order_no = ? WHERE id = ?').run(orderNo(orderId), orderId);

  persistItems(db, orderId, items);

  return orderToJson(db, rowById(orderId));
}

/**
 * Convert an accepted quotation into a sales order. The quotation must belong
 * to the acting user's scope and be in `Accepted` status; its customer and
 * line items are copied verbatim (totals recomputed). The source quotation is
 * deliberately left in `Accepted` (no auto-advance), and a duplicate-conversion
 * guard rejects converting the same quotation twice.
 */
export function convertQuotationToOrder(scope, companyId, data, userId) {
  const db = getDb();
  if (!companyId) throw badRequest('A company is required to convert a quotation');

  const quotation = db
    .prepare('SELECT * FROM quotations WHERE id = ? AND deleted_at IS NULL')
    .get(data.quotationId);
  if (!quotation) throw notFound('Quotation not found');
  if (!canAccessQuotation(scope, quotation)) throw forbidden('You cannot access this quotation');
  if (quotation.company_id !== companyId) throw forbidden('Quotation does not belong to this company');
  if (quotation.status !== 'Accepted') {
    throw conflict('Only an accepted quotation can be converted into an order');
  }

  const already = db
    .prepare('SELECT id FROM orders WHERE quotation_id = ? AND deleted_at IS NULL LIMIT 1')
    .get(quotation.id);
  if (already) throw conflict('This quotation has already been converted into an order');

  assertCustomerInCompany(db, quotation.customer_id, companyId);
  assertAssignee(db, companyId, data.assignedTo, data.teamId);

  let assignedTo = data.assignedTo ?? quotation.assigned_to ?? null;
  let teamId = data.teamId ?? quotation.team_id ?? null;
  if (assignedTo == null && teamId == null && scope.type === 'self') {
    assignedTo = userId;
  }

  // Copy the quotation line items verbatim, preserving the snapshot stored on
  // the quotation. Re-resolving from the live product catalogue here would
  // break accepted quotations whose product price changed (or whose product was
  // since removed), so the order must honour the amounts the customer accepted.
  const items = db
    .prepare('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY id ASC')
    .all(quotation.id)
    .map((it) => ({
      productId: it.product_id,
      name: it.name,
      unit: it.unit,
      quantity: it.quantity,
      unitPrice: it.unit_price,
      taxRate: it.tax_rate,
      amount: it.amount,
    }));
  const totals = computeTotals(items, quotation.discount ?? 0);

  const info = db
    .prepare(
      `INSERT INTO orders (company_id, customer_id, quotation_id, status, subtotal, tax_amount, discount, total, assigned_to, team_id, notes, created_by)
       VALUES (?, ?, ?, 'Confirmed', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      companyId,
      quotation.customer_id,
      quotation.id,
      totals.subtotal,
      totals.taxAmount,
      quotation.discount ?? 0,
      totals.total,
      assignedTo,
      teamId,
      data.notes ?? null,
      userId ?? null
    );
  const orderId = Number(info.lastInsertRowid);
  db.prepare('UPDATE orders SET order_no = ? WHERE id = ?').run(orderNo(orderId), orderId);

  persistItems(db, orderId, items);

  return orderToJson(db, rowById(orderId));
}

/**
 * Update an order (partial) within the acting user's scope. When `items` are
 * supplied, line items are replaced and totals recomputed.
 */
export function updateOrder(scope, id, data) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!row || row.deleted_at) throw notFound('Order not found');
  if (!canAccessOrder(scope, row)) throw forbidden('You cannot modify this order');

  if (data.assignedTo !== undefined && data.assignedTo != null) {
    const u = db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(data.assignedTo, row.company_id);
    if (!u) throw badRequest('Assigned salesperson does not belong to this company');
  }
  if (data.teamId !== undefined && data.teamId != null) {
    const t = db.prepare('SELECT id FROM teams WHERE id = ? AND company_id = ?').get(data.teamId, row.company_id);
    if (!t) throw badRequest('Team does not belong to this company');
  }

  const sets = [];
  const values = [];
  const fieldMap = {
    status: 'status',
    discount: 'discount',
    assignedTo: 'assigned_to',
    teamId: 'team_id',
    notes: 'notes',
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
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(row.id);
    persistItems(db, row.id, items);
  } else if (data.discount !== undefined) {
    const items = db
      .prepare('SELECT * FROM order_items WHERE order_id = ?')
      .all(row.id)
      .map((r) => ({ amount: r.amount, taxRate: r.tax_rate }));
    const totals = computeTotals(items, data.discount);
    sets.push('subtotal = ?', 'tax_amount = ?', 'total = ?');
    values.push(totals.subtotal, totals.taxAmount, totals.total);
  }

  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(row.id);
    db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  return orderToJson(db, rowById(row.id));
}

/**
 * Soft-delete an order within the acting user's scope.
 */
export function deleteOrder(scope, id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!row || row.deleted_at) throw notFound('Order not found');
  if (!canAccessOrder(scope, row)) throw forbidden('You cannot delete this order');

  db.prepare(
    "UPDATE orders SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  ).run(row.id);

  return { id: row.id, deleted: true };
}
