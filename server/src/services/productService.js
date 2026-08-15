// ============================================================================
// Product/service catalogue. Company-wide master data: every tenant row is
// scoped to its company via `access.js`, and the acting user's `company_id`
// is always derived from the authenticated context — never from client input.
// ============================================================================

import { getDb } from '../db/connection.js';
import { notFound, forbidden, badRequest } from '../lib/httpError.js';
import { buildProductScopeWhere, canAccessProduct } from './access.js';

const PRODUCT_SELECT = `
  SELECT p.*, u.name AS created_by_name
  FROM products p
  LEFT JOIN users u ON u.id = p.created_by
`;

const SORTABLE = {
  name: 'p.name',
  sku: 'p.sku',
  category: 'p.category',
  unitPrice: 'p.unit_price',
  createdAt: 'p.created_at',
};

export function productToJson(p) {
  return {
    id: p.id,
    productNo: p.product_no,
    companyId: p.company_id,
    name: p.name,
    sku: p.sku || null,
    category: p.category || null,
    description: p.description || null,
    unit: p.unit || null,
    unitPrice: p.unit_price,
    taxRate: p.tax_rate,
    status: p.status,
    createdBy: p.created_by,
    createdByName: p.created_by_name || null,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function rowById(id) {
  return getDb().prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id);
}

/**
 * List products scoped to the acting user's data scope.
 * @param {object} scope result of getUserDataScope
 * @param {object} query parsed list query
 */
export function listProducts(scope, query) {
  const db = getDb();
  const {
    page, pageSize, search, category, status, companyId, sort, order,
  } = query;

  const { where: baseWhere, params: baseParams } = buildProductScopeWhere(scope, 'p');

  const clauses = [];
  const params = [...baseParams];
  if (search) {
    clauses.push('(p.name LIKE ? OR p.sku LIKE ? OR p.category LIKE ? OR p.description LIKE ? OR p.product_no LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }
  if (category) {
    clauses.push('p.category = ?');
    params.push(category);
  }
  if (status) {
    clauses.push('p.status = ?');
    params.push(status);
  }
  if (companyId && scope.type === 'all') {
    clauses.push('p.company_id = ?');
    params.push(companyId);
  }

  let where = baseWhere;
  if (clauses.length) where = baseWhere ? `${baseWhere} AND ${clauses.join(' AND ')}` : `WHERE ${clauses.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) AS c FROM products p ${where}`).get(...params).c;

  const sortColumn = SORTABLE[sort] || 'p.created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  const rows = db
    .prepare(`${PRODUCT_SELECT} ${where} ORDER BY ${sortColumn} ${sortOrder}, p.id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);

  return { data: rows.map(productToJson), total };
}

/**
 * Fetch a single product within the acting user's scope.
 */
export function getProduct(scope, id) {
  const row = rowById(id);
  if (!row || row.deleted_at) throw notFound('Product not found');
  if (!canAccessProduct(scope, row)) throw forbidden('You cannot access this product');
  return productToJson(row);
}

/**
 * Create a product for `companyId` (already derived from the authenticated
 * context). Enforces the caller's data scope over the target company.
 */
export function createProduct(scope, companyId, data, userId) {
  const db = getDb();
  if (!companyId) throw badRequest('A company is required to create a product');
  assertCanManageCompany(scope, companyId);

  const info = db
    .prepare(
      `INSERT INTO products (company_id, name, sku, category, description, unit, unit_price, tax_rate, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      companyId,
      data.name,
      data.sku ?? null,
      data.category ?? null,
      data.description ?? null,
      data.unit ?? null,
      data.unitPrice ?? 0,
      data.taxRate ?? 0,
      data.status ?? 'Active',
      userId ?? null
    );
  const productId = Number(info.lastInsertRowid);
  const productNo = `PRD-${String(productId).padStart(6, '0')}`;
  db.prepare('UPDATE products SET product_no = ? WHERE id = ?').run(productNo, productId);

  return productToJson(rowById(productId));
}

/**
 * Update a product (partial) within the acting user's scope.
 */
export function updateProduct(scope, id, data) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!row || row.deleted_at) throw notFound('Product not found');
  if (!canAccessProduct(scope, row)) throw forbidden('You cannot modify this product');

  const fieldMap = {
    name: 'name',
    sku: 'sku',
    category: 'category',
    description: 'description',
    unit: 'unit',
    unitPrice: 'unit_price',
    taxRate: 'tax_rate',
    status: 'status',
  };

  const sets = [];
  const values = [];
  for (const [input, column] of Object.entries(fieldMap)) {
    if (data[input] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(data[input]);
    }
  }

  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    values.push(row.id);
    db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  return productToJson(rowById(row.id));
}

/**
 * Soft-delete a product within the acting user's scope.
 */
export function deleteProduct(scope, id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!row || row.deleted_at) throw notFound('Product not found');
  if (!canAccessProduct(scope, row)) throw forbidden('You cannot delete this product');

  db.prepare(
    "UPDATE products SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  ).run(row.id);

  return { id: row.id, deleted: true };
}

/**
 * A super admin may manage any company; other scopes may only touch their own.
 */
function assertCanManageCompany(scope, companyId) {
  if (scope.type === 'all') return;
  if (companyId !== scope.companyId) throw forbidden('You cannot create products for another company');
}
