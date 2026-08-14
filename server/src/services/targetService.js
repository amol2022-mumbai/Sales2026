// ============================================================================
// Target domain constants and achievement computation. Achievement is always
// derived from real source data (won opportunities, leads, customers) — never
// stored or fabricated. Collections have no source module yet, so their
// achievement is honestly reported as 0.
// ============================================================================

export const TARGET_SCOPES = ['company', 'team', 'user', 'product', 'territory'];

export const TARGET_TYPES = ['sales', 'collection', 'new_leads', 'new_customers', 'conversion_rate'];

export const TARGET_PERIODS = ['monthly', 'quarterly', 'annual'];

export const TARGET_STATUSES = ['Active', 'Paused', 'Completed', 'Cancelled'];

export const TARGET_TYPE_LABELS = {
  sales: 'Sales / Revenue',
  collection: 'Collection',
  new_leads: 'New Leads',
  new_customers: 'New Customers',
  conversion_rate: 'Conversion Rate',
};

export const TARGET_TYPE_UNITS = {
  sales: 'currency',
  collection: 'currency',
  new_leads: 'count',
  new_customers: 'count',
  conversion_rate: 'percent',
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Build the scope-filter SQL fragment for a given source-table alias. The
 * company filter is applied separately by each query; product scope only
 * applies to tables that carry a `product_service` column (opportunities and
 * leads).
 */
function scopeClause(scope, target, alias) {
  switch (scope) {
    case 'team':
      return { sql: `AND ${alias}.team_id = ?`, params: [target.team_id] };
    case 'user':
      return { sql: `AND ${alias}.assigned_to = ?`, params: [target.user_id] };
    case 'product':
      return { sql: `AND ${alias}.product_service = ?`, params: [target.product] };
    case 'territory':
      return {
        sql: `AND ${alias}.assigned_to IN (SELECT id FROM users WHERE company_id = ? AND territory = ?)`,
        params: [target.company_id, target.territory],
      };
    default:
      return { sql: '', params: [] };
  }
}

/**
 * Compute the actual result for a target from real data.
 * @returns {number}
 */
export function computeActual(db, target) {
  const { scope, target_type: type, company_id: companyId, start_date: start, end_date: end } = target;

  switch (type) {
    case 'sales': {
      const { sql, params } = scopeClause(scope, target, 'o');
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(o.deal_value), 0) AS v
           FROM opportunities o
           WHERE o.company_id = ? AND o.stage = 'Won' AND o.deleted_at IS NULL
             AND o.expected_close_date BETWEEN ? AND ? ${sql}`
        )
        .get(companyId, start, end, ...params);
      return round2(row.v);
    }
    case 'collection':
      // No collections module yet; report zero rather than inventing numbers.
      return 0;
    case 'new_leads': {
      const { sql, params } = scopeClause(scope, target, 'l');
      const row = db
        .prepare(
          `SELECT COUNT(*) AS c FROM leads l
           WHERE l.company_id = ? AND l.deleted_at IS NULL
             AND date(l.created_at) BETWEEN ? AND ? ${sql}`
        )
        .get(companyId, start, end, ...params);
      return row.c;
    }
    case 'new_customers': {
      // Customers carry no product dimension; product-scoped targets match none.
      if (scope === 'product') return 0;
      const { sql, params } = scopeClause(scope, target, 'c');
      const row = db
        .prepare(
          `SELECT COUNT(*) AS c FROM customers c
           WHERE c.company_id = ? AND c.deleted_at IS NULL
             AND date(c.created_at) BETWEEN ? AND ? ${sql}`
        )
        .get(companyId, start, end, ...params);
      return row.c;
    }
    case 'conversion_rate': {
      const { sql, params } = scopeClause(scope, target, 'o');
      const row = db
        .prepare(
          `SELECT
             SUM(CASE WHEN o.stage = 'Won' THEN 1 ELSE 0 END) AS won,
             SUM(CASE WHEN o.stage IN ('Won','Lost') THEN 1 ELSE 0 END) AS closed
           FROM opportunities o
           WHERE o.company_id = ? AND o.deleted_at IS NULL
             AND o.expected_close_date BETWEEN ? AND ? ${sql}`
        )
        .get(companyId, start, end, ...params);
      const won = row.won || 0;
      const closed = row.closed || 0;
      return closed > 0 ? Math.round((won / closed) * 1000) / 10 : 0;
    }
    default:
      return 0;
  }
}

/**
 * Compute achievement + balance + achievement % for a target row.
 */
export function withAchievement(db, target) {
  const targetValue = Number(target.target_value) || 0;
  const achievement = computeActual(db, target);
  const balance = round2(targetValue - achievement);
  const achievementPct = targetValue > 0 ? Math.round((achievement / targetValue) * 1000) / 10 : 0;
  return { achievement, balance, achievementPct };
}

/**
 * Contributing source rows for a target's achievement (used by the detail
 * view so users can see exactly which real records back a number).
 */
export function getAchievementBreakdown(db, target) {
  const { scope, target_type: type, company_id: companyId, start_date: start, end_date: end } = target;

  if (type === 'sales' || type === 'conversion_rate') {
    const { sql, params } = scopeClause(scope, target, 'o');
    const stageFilter = type === 'sales' ? "o.stage = 'Won'" : "o.stage IN ('Won','Lost')";
    return db
      .prepare(
        `SELECT o.id, o.opportunity_no, o.product_service, o.deal_value, o.stage,
                o.expected_close_date, u.name AS assigned_name
         FROM opportunities o LEFT JOIN users u ON u.id = o.assigned_to
         WHERE o.company_id = ? AND ${stageFilter} AND o.deleted_at IS NULL
           AND o.expected_close_date BETWEEN ? AND ? ${sql}
         ORDER BY o.expected_close_date ASC, o.id ASC LIMIT 500`
      )
      .all(companyId, start, end, ...params)
      .map((r) => ({
        id: r.id,
        opportunityNo: r.opportunity_no,
        productService: r.product_service,
        dealValue: r.deal_value,
        stage: r.stage,
        expectedCloseDate: r.expected_close_date,
        assignedName: r.assigned_name || null,
      }));
  }

  if (type === 'new_leads') {
    const { sql, params } = scopeClause(scope, target, 'l');
    return db
      .prepare(
        `SELECT l.id, l.lead_no, l.company_name, l.contact_person, date(l.created_at) AS created_date
         FROM leads l
         WHERE l.company_id = ? AND l.deleted_at IS NULL
           AND date(l.created_at) BETWEEN ? AND ? ${sql}
         ORDER BY l.created_at ASC, l.id ASC LIMIT 500`
      )
      .all(companyId, start, end, ...params)
      .map((r) => ({
        id: r.id,
        leadNo: r.lead_no,
        companyName: r.company_name,
        contactPerson: r.contact_person,
        createdAt: r.created_date,
      }));
  }

  if (type === 'new_customers') {
    if (scope === 'product') return [];
    const { sql, params } = scopeClause(scope, target, 'c');
    return db
      .prepare(
        `SELECT c.id, c.customer_no, c.name, c.contact_person, date(c.created_at) AS created_date
         FROM customers c
         WHERE c.company_id = ? AND c.deleted_at IS NULL
           AND date(c.created_at) BETWEEN ? AND ? ${sql}
         ORDER BY c.created_at ASC, c.id ASC LIMIT 500`
      )
      .all(companyId, start, end, ...params)
      .map((r) => ({
        id: r.id,
        customerNo: r.customer_no,
        name: r.name,
        contactPerson: r.contact_person,
        createdAt: r.created_date,
      }));
  }

  return [];
}
