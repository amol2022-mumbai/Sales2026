// ============================================================================
// Collections (invoices & payments) helpers. Amounts are derived, never
// fabricated: an invoice's paid amount is the sum of its non-deleted payments,
// and its status is recomputed from that balance. Overdue is derived (unpaid
// balance with a past due date) rather than stored.
// ============================================================================

function pad6(n) {
  return String(n).padStart(6, '0');
}

export function invoiceNo(id) {
  return `INV-${pad6(id)}`;
}

export function paymentNo(id) {
  return `PAY-${pad6(id)}`;
}

/**
 * Sum of non-deleted payments applied to an invoice.
 */
export function invoicePaid(db, invoiceId) {
  const row = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM payments WHERE invoice_id = ? AND deleted_at IS NULL')
    .get(invoiceId);
  return Math.round(row.v * 100) / 100;
}

/**
 * Sum of non-deleted payments for many invoices in a single query (avoids an
 * N+1 query pattern when listing invoices or computing aging reports).
 * Returns a Map of invoice_id -> paid amount.
 */
export function invoicePaidByInvoiceIds(db, invoiceIds) {
  const map = new Map();
  if (!invoiceIds.length) return map;
  const placeholders = invoiceIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT invoice_id, COALESCE(SUM(amount), 0) AS v FROM payments WHERE invoice_id IN (${placeholders}) AND deleted_at IS NULL GROUP BY invoice_id`
    )
    .all(...invoiceIds);
  for (const r of rows) map.set(r.invoice_id, Math.round(r.v * 100) / 100);
  return map;
}

export function invoiceBalance(db, invoice) {
  const amount = Number(invoice.amount) || 0;
  const paid = invoicePaid(db, invoice.id);
  return Math.round((amount - paid) * 100) / 100;
}

export function deriveInvoiceStatus(balance, amount) {
  if (balance <= 0) return 'Paid';
  if (balance < amount) return 'Partial';
  return 'Unpaid';
}

/**
 * Recompute and persist an invoice's status from its payment balance.
 */
export function recomputeInvoiceStatus(db, invoiceId) {
  const invoice = db.prepare('SELECT id, amount FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) return;
  const balance = invoiceBalance(db, invoice);
  const status = deriveInvoiceStatus(balance, invoice.amount);
  db.prepare("UPDATE invoices SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(status, invoiceId);
}

export function isOverdue(invoice, balance) {
  if (balance <= 0 || !invoice.due_date) return false;
  return invoice.due_date < new Date().toISOString().slice(0, 10);
}
