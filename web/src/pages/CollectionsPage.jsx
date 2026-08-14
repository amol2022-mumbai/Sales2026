import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Trash2, Wallet, FileText, CreditCard, Receipt } from 'lucide-react';
import { collectionsApi, customersApi, usersApi, teamsApi } from '../api/endpoints.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';

const STATUS_TONE = { Unpaid: 'rose', Partial: 'amber', Paid: 'green' };
const METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'UPI', 'Card', 'Other'];

function currency(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const EMPTY_INVOICE = { customerId: '', amount: '', dueDate: '', assignedTo: '', teamId: '', notes: '' };
const EMPTY_PAYMENT = { invoiceId: '', amount: '', paymentDate: '', method: 'Bank Transfer', reference: '', notes: '' };

export default function CollectionsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('dashboard');

  const [dash, setDash] = useState(null);

  const [invoices, setInvoices] = useState([]);
  const [invoiceMeta, setInvoiceMeta] = useState(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [invoiceSort, setInvoiceSort] = useState('createdAt');
  const [invoiceOrder, setInvoiceOrder] = useState('desc');
  const [invoicePage, setInvoicePage] = useState(1);

  const [payments, setPayments] = useState([]);
  const [paymentMeta, setPaymentMeta] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentPage, setPaymentPage] = useState(1);

  const [customers, setCustomers] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);

  const [invoiceModal, setInvoiceModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [invoiceForm, setInvoiceForm] = useState(EMPTY_INVOICE);
  const [paymentModal, setPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const loadDashboard = useCallback(async () => {
    try {
      setDash(await collectionsApi.dashboard());
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    setInvoiceLoading(true);
    try {
      const params = { page: invoicePage, pageSize: 10, sort: invoiceSort, order: invoiceOrder };
      if (invoiceSearch) params.search = invoiceSearch;
      if (statusFilter) params.status = statusFilter;
      const res = await collectionsApi.invoices.list(params);
      setInvoices(res.data);
      setInvoiceMeta(res.meta);
    } catch (e) {
      setError(e.message);
    } finally {
      setInvoiceLoading(false);
    }
  }, [invoicePage, invoiceSearch, statusFilter, invoiceSort, invoiceOrder]);

  const loadPayments = useCallback(async () => {
    setPaymentLoading(true);
    try {
      const res = await collectionsApi.payments.list({ page: paymentPage, pageSize: 10 });
      setPayments(res.data);
      setPaymentMeta(res.meta);
    } catch (e) {
      setError(e.message);
    } finally {
      setPaymentLoading(false);
    }
  }, [paymentPage]);

  useEffect(() => {
    loadDashboard();
    customersApi.list({ pageSize: 100 }).then((r) => setCustomers(r.data)).catch(() => {});
    usersApi.list({ pageSize: 100 }).then((r) => setUsers(r.data)).catch(() => {});
    teamsApi.list({ pageSize: 100 }).then((r) => setTeams(r.data)).catch(() => {});
  }, [loadDashboard]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    if (tab === 'payments') loadPayments();
  }, [tab, loadPayments]);

  function updateInvoice(key) {
    return (e) => setInvoiceForm((f) => ({ ...f, [key]: e.target.value }));
  }

  function updatePayment(key) {
    return (e) => setPaymentForm((f) => ({ ...f, [key]: e.target.value }));
  }

  function openCreateInvoice() {
    setEditing(null);
    setInvoiceForm(EMPTY_INVOICE);
    setInvoiceModal(true);
  }

  function openEditInvoice(inv) {
    setEditing(inv);
    setInvoiceForm({
      customerId: inv.customerId ?? '',
      amount: inv.amount ?? '',
      dueDate: inv.dueDate || '',
      assignedTo: inv.assignedTo ?? '',
      teamId: inv.teamId ?? '',
      notes: inv.notes || '',
    });
    setInvoiceModal(true);
  }

  function openRecordPayment(inv) {
    setPaymentForm({ ...EMPTY_PAYMENT, invoiceId: inv ? inv.id : '', paymentDate: new Date().toISOString().slice(0, 10) });
    setPaymentModal(true);
  }

  async function saveInvoice() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        customerId: Number(invoiceForm.customerId),
        amount: Number(invoiceForm.amount),
        dueDate: invoiceForm.dueDate || null,
        assignedTo: invoiceForm.assignedTo ? Number(invoiceForm.assignedTo) : null,
        teamId: invoiceForm.teamId ? Number(invoiceForm.teamId) : null,
        notes: invoiceForm.notes || null,
      };
      if (editing) await collectionsApi.invoices.update(editing.id, payload);
      else await collectionsApi.invoices.create(payload);
      setInvoiceModal(false);
      setMessage(editing ? 'Invoice updated.' : 'Invoice created.');
      loadDashboard();
      loadInvoices();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function savePayment() {
    setSaving(true);
    setError(null);
    try {
      await collectionsApi.payments.record({
        invoiceId: Number(paymentForm.invoiceId),
        amount: Number(paymentForm.amount),
        paymentDate: paymentForm.paymentDate,
        method: paymentForm.method,
        reference: paymentForm.reference || null,
        notes: paymentForm.notes || null,
      });
      setPaymentModal(false);
      setMessage('Payment recorded.');
      loadDashboard();
      loadPayments();
      loadInvoices();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteInvoice(inv) {
    setDeleting(inv.id);
    try {
      await collectionsApi.invoices.remove(inv.id);
      setMessage('Invoice deleted.');
      loadDashboard();
      loadInvoices();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  }

  async function confirmDeletePayment(p) {
    setDeleting(p.id);
    try {
      await collectionsApi.payments.remove(p.id);
      setMessage('Payment deleted.');
      loadDashboard();
      loadPayments();
      loadInvoices();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Collections</h1>
          <p className="mt-1 text-sm text-slate-500">Invoices, payments and accounts receivable ageing.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can(user, 'collections:create') && (
            <>
              <button type="button" className="btn-secondary" onClick={() => openRecordPayment(null)}>
                <CreditCard className="h-4 w-4" /> Record payment
              </button>
              <button type="button" className="btn-primary" onClick={openCreateInvoice}>
                <Plus className="h-4 w-4" /> New invoice
              </button>
            </>
          )}
        </div>
      </div>

      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <div className="flex rounded-lg border border-slate-200 p-0.5">
        {[
          ['dashboard', 'Overview', Wallet],
          ['invoices', 'Invoices', FileText],
          ['payments', 'Payments', Receipt],
        ].map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${tab === key ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            onClick={() => setTab(key)}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && (
        <div className="space-y-6">
          {dash ? (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {[
                  { label: 'Invoiced', value: currency(dash.invoiced), hint: `${dash.invoiceCount} invoices` },
                  { label: 'Collected', value: currency(dash.collected), hint: 'Payments received' },
                  { label: 'Outstanding', value: currency(dash.outstanding), hint: 'Receivable balance' },
                ].map((k) => (
                  <Card key={k.label} className="p-4">
                    <p className="text-xl font-semibold text-slate-900">{k.value}</p>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">{k.label}</p>
                    <p className="text-xs text-slate-400">{k.hint}</p>
                  </Card>
                ))}
              </div>

              <Card className="p-5">
                <h3 className="mb-4 text-sm font-semibold text-slate-700">Receivable ageing</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {dash.aging.map((b) => (
                    <div key={b.bucket} className="rounded-lg bg-slate-50 p-3">
                      <p className="text-xs text-slate-500">{b.bucket}</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">{currency(b.amount)}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          ) : (
            <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8 text-brand-600" /></div>
          )}
        </div>
      )}

      {tab === 'invoices' && (
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-9"
                placeholder="Search invoice no, customer…"
                value={invoiceSearch}
                onChange={(e) => { setInvoiceSearch(e.target.value); setInvoicePage(1); }}
              />
            </div>
            <select className="input w-auto" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setInvoicePage(1); }}>
              <option value="">All statuses</option>
              <option value="Unpaid">Unpaid</option>
              <option value="Partial">Partial</option>
              <option value="Paid">Paid</option>
              <option value="Overdue">Overdue</option>
            </select>
            <select className="input w-auto" value={invoiceSort} onChange={(e) => { setInvoiceSort(e.target.value); setInvoicePage(1); }}>
              <option value="createdAt">Created</option>
              <option value="invoiceNo">Invoice no</option>
              <option value="amount">Amount</option>
              <option value="dueDate">Due date</option>
              <option value="status">Status</option>
            </select>
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setInvoiceOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}>
              {invoiceOrder === 'asc' ? 'Ascending' : 'Descending'}
            </button>
          </div>

          {invoiceLoading ? (
            <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8 text-brand-600" /></div>
          ) : invoices.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-slate-500">No invoices found.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-5 py-3 font-semibold">Invoice</th>
                      <th className="px-5 py-3 font-semibold">Customer</th>
                      <th className="px-5 py-3 font-semibold">Due</th>
                      <th className="px-5 py-3 font-semibold">Amount</th>
                      <th className="px-5 py-3 font-semibold">Balance</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <p className="font-medium text-slate-900">{inv.invoiceNo}</p>
                          <p className="text-xs text-slate-400">{inv.assignedName || '—'}</p>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{inv.customerName}</td>
                        <td className="px-5 py-3 text-slate-600">{formatDate(inv.dueDate)}</td>
                        <td className="px-5 py-3 text-slate-600">{currency(inv.amount)}</td>
                        <td className="px-5 py-3 font-medium text-slate-900">{currency(inv.balance)}</td>
                        <td className="px-5 py-3">
                          <Badge tone={inv.overdue ? 'rose' : STATUS_TONE[inv.status] || 'slate'}>
                            {inv.overdue && inv.status !== 'Paid' ? 'Overdue' : inv.status}
                          </Badge>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {can(user, 'collections:create') && inv.status !== 'Paid' && (
                              <button type="button" className="btn-ghost px-2 py-1" title="Record payment" onClick={() => openRecordPayment(inv)}>
                                <CreditCard className="h-4 w-4" />
                              </button>
                            )}
                            {can(user, 'collections:edit') && (
                              <button type="button" className="btn-ghost px-2 py-1" title="Edit" onClick={() => openEditInvoice(inv)}>
                                <span className="text-xs font-medium text-brand-600">Edit</span>
                              </button>
                            )}
                            {can(user, 'collections:delete') && (
                              <button type="button" className="btn-ghost px-2 py-1" title="Delete" onClick={() => confirmDeleteInvoice(inv)}>
                                {deleting === inv.id ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4 text-rose-500" />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination meta={invoiceMeta} onPage={setInvoicePage} />
            </>
          )}
        </Card>
      )}

      {tab === 'payments' && (
        <Card>
          {paymentLoading ? (
            <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8 text-brand-600" /></div>
          ) : payments.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-slate-500">No payments recorded.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-5 py-3 font-semibold">Payment</th>
                      <th className="px-5 py-3 font-semibold">Invoice</th>
                      <th className="px-5 py-3 font-semibold">Customer</th>
                      <th className="px-5 py-3 font-semibold">Date</th>
                      <th className="px-5 py-3 font-semibold">Method</th>
                      <th className="px-5 py-3 font-semibold">Amount</th>
                      <th className="px-5 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {payments.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3 font-medium text-slate-900">{p.paymentNo}</td>
                        <td className="px-5 py-3 text-slate-600">{p.invoiceNo}</td>
                        <td className="px-5 py-3 text-slate-600">{p.customerName}</td>
                        <td className="px-5 py-3 text-slate-600">{formatDate(p.paymentDate)}</td>
                        <td className="px-5 py-3 text-slate-600">{p.method}</td>
                        <td className="px-5 py-3 font-medium text-slate-900">{currency(p.amount)}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {can(user, 'collections:delete') && (
                              <button type="button" className="btn-ghost px-2 py-1" title="Delete" onClick={() => confirmDeletePayment(p)}>
                                {deleting === p.id ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4 text-rose-500" />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination meta={paymentMeta} onPage={setPaymentPage} />
            </>
          )}
        </Card>
      )}

      <Modal
        open={invoiceModal}
        title={editing ? 'Edit invoice' : 'New invoice'}
        onClose={() => setInvoiceModal(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setInvoiceModal(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={saveInvoice} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : editing ? 'Save changes' : 'Create invoice'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="invCustomer">Customer</label>
            <select id="invCustomer" className="input" value={invoiceForm.customerId} onChange={updateInvoice('customerId')}>
              <option value="">Select…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="invAmount">Amount</label>
            <input id="invAmount" type="number" min="0" step="any" className="input" value={invoiceForm.amount} onChange={updateInvoice('amount')} />
          </div>
          <div>
            <label className="label" htmlFor="invDue">Due date</label>
            <input id="invDue" type="date" className="input" value={invoiceForm.dueDate} onChange={updateInvoice('dueDate')} />
          </div>
          <div>
            <label className="label" htmlFor="invAssigned">Salesperson</label>
            <select id="invAssigned" className="input" value={invoiceForm.assignedTo} onChange={updateInvoice('assignedTo')}>
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="invTeam">Team</label>
            <select id="invTeam" className="input" value={invoiceForm.teamId} onChange={updateInvoice('teamId')}>
              <option value="">None</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="invNotes">Notes</label>
            <textarea id="invNotes" className="input" rows={2} value={invoiceForm.notes} onChange={updateInvoice('notes')} />
          </div>
        </div>
      </Modal>

      <Modal
        open={paymentModal}
        title="Record payment"
        onClose={() => setPaymentModal(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setPaymentModal(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={savePayment} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : 'Record payment'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="payInvoice">Invoice</label>
            <select id="payInvoice" className="input" value={paymentForm.invoiceId} onChange={updatePayment('invoiceId')}>
              <option value="">Select…</option>
              {invoices.map((inv) => <option key={inv.id} value={inv.id}>{inv.invoiceNo} — {inv.customerName}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="payAmount">Amount</label>
            <input id="payAmount" type="number" min="0" step="any" className="input" value={paymentForm.amount} onChange={updatePayment('amount')} />
          </div>
          <div>
            <label className="label" htmlFor="payDate">Payment date</label>
            <input id="payDate" type="date" className="input" value={paymentForm.paymentDate} onChange={updatePayment('paymentDate')} />
          </div>
          <div>
            <label className="label" htmlFor="payMethod">Method</label>
            <select id="payMethod" className="input" value={paymentForm.method} onChange={updatePayment('method')}>
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="payRef">Reference</label>
            <input id="payRef" className="input" value={paymentForm.reference} onChange={updatePayment('reference')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="payNotes">Notes</label>
            <textarea id="payNotes" className="input" rows={2} value={paymentForm.notes} onChange={updatePayment('notes')} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
