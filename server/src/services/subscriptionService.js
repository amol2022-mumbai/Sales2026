// ============================================================================
// Subscription billing helpers. A "subscription" is a tenant (company) with a
// license + plan. Subscription invoices are billing records issued to the
// tenant for their plan; amounts and statuses are derived from real
// subscription payments, never fabricated. Overdue is derived (unpaid balance
// past the due date) rather than stored.
// ============================================================================

function pad6(n) {
  return String(n).padStart(6, '0');
}

export function subscriptionInvoiceNo(id) {
  return `SINV-${pad6(id)}`;
}

export function subscriptionPaymentNo(id) {
  return `SPAY-${pad6(id)}`;
}

/**
 * Net amount applied to a subscription invoice: sum of payment-type records
 * minus refund-type records (soft-deleted records excluded). Refunds reduce
 * the paid balance.
 */
export function subscriptionInvoicePaid(db, invoiceId) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END), 0) AS v
       FROM subscription_payments WHERE invoice_id = ? AND deleted_at IS NULL`
    )
    .get(invoiceId);
  return Math.round(row.v * 100) / 100;
}

/**
 * Total net payments received by a company across all of its subscription
 * invoices (refunds subtract).
 */
export function subscriptionCompanyPaid(db, companyId) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END), 0) AS v
       FROM subscription_payments WHERE company_id = ? AND deleted_at IS NULL`
    )
    .get(companyId);
  return Math.round(row.v * 100) / 100;
}

/**
 * Total billed amount for a company's subscription invoices (voids excluded).
 */
export function subscriptionCompanyBilled(db, companyId) {
  const row = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM subscription_invoices WHERE company_id = ? AND status != 'Void'")
    .get(companyId);
  return Math.round(row.v * 100) / 100;
}

export function subscriptionInvoiceBalance(db, invoice) {
  const amount = Number(invoice.amount) || 0;
  const paid = subscriptionInvoicePaid(db, invoice.id);
  return Math.round((amount - paid) * 100) / 100;
}

/**
 * Derive the lifecycle status from the payment balance. A voided invoice keeps
 * its `Void` status; otherwise the status follows the balance.
 */
export function deriveSubscriptionInvoiceStatus(invoice, balance) {
  if (invoice.status === 'Void') return 'Void';
  if (balance <= 0) return 'Paid';
  if (balance < Number(invoice.amount) || 0) return 'Partial';
  return 'Unpaid';
}

/**
 * Recompute and persist a subscription invoice's status from its payment
 * balance.
 */
export function recomputeSubscriptionInvoiceStatus(db, invoiceId) {
  const invoice = db.prepare('SELECT id, amount, status FROM subscription_invoices WHERE id = ?').get(invoiceId);
  if (!invoice) return;
  const balance = subscriptionInvoiceBalance(db, invoice);
  const status = deriveSubscriptionInvoiceStatus(invoice, balance);
  db.prepare("UPDATE subscription_invoices SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(status, invoiceId);
}

export function isSubscriptionOverdue(invoice, balance) {
  if (balance <= 0 || !invoice.due_date) return false;
  return invoice.due_date < new Date().toISOString().slice(0, 10);
}
