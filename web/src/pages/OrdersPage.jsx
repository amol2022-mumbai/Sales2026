import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Eye, ShoppingCart, ArrowRightLeft, X } from 'lucide-react';
import { ordersApi, customersApi, productsApi, quotationsApi } from '../api/endpoints.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import Modal from '../components/ui/Modal.jsx';
import Badge from '../components/ui/Badge.jsx';

const STATUSES = ['Draft', 'Confirmed', 'Processing', 'Completed', 'Cancelled'];
const STATUS_TONE = {
  Draft: 'slate',
  Confirmed: 'indigo',
  Processing: 'amber',
  Completed: 'green',
  Cancelled: 'rose',
};

const EMPTY_ITEM = { productId: '', name: '', unit: '', quantity: '1', unitPrice: '0', taxRate: '0' };
const EMPTY_FORM = {
  customerId: '',
  status: 'Draft',
  discount: '0',
  notes: '',
  items: [{ ...EMPTY_ITEM }],
};

const fmt = (n) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(n) || 0);

export default function OrdersPage() {
  const { user } = useAuth();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [convertOpen, setConvertOpen] = useState(false);
  const [quotations, setQuotations] = useState([]);
  const [convertId, setConvertId] = useState('');
  const [converting, setConverting] = useState(false);

  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ordersApi.list({ pageSize: 100 });
      setOrders(res.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    customersApi.list({ pageSize: 100 }).then((r) => setCustomers(r.data)).catch(() => {});
    productsApi.list({ pageSize: 100 }).then((r) => setProducts(r.data)).catch(() => {});
  }, []);

  const productById = useMemo(() => {
    const map = {};
    for (const p of products) map[p.id] = p;
    return map;
  }, [products]);

  const totals = useMemo(() => {
    const discount = Number(form.discount) || 0;
    const items = form.items.map((it) => {
      const qty = Number(it.quantity) || 0;
      const price = Number(it.unitPrice) || 0;
      const tax = Number(it.taxRate) || 0;
      const amount = qty * price;
      return { amount, tax: (amount * tax) / 100 };
    });
    const subtotal = items.reduce((s, i) => s + i.amount, 0);
    const taxAmount = items.reduce((s, i) => s + i.tax, 0);
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      taxAmount: Math.round(taxAmount * 100) / 100,
      total: Math.round((subtotal + taxAmount - discount) * 100) / 100,
    };
  }, [form.items, form.discount]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(o) {
    setEditing(o);
    setForm({
      customerId: o.customerId || '',
      status: o.status || 'Draft',
      discount: o.discount ?? '0',
      notes: o.notes || '',
      items: (o.items || []).map((it) => ({
        productId: it.productId ? String(it.productId) : '',
        name: it.name || '',
        unit: it.unit || '',
        quantity: String(it.quantity ?? 1),
        unitPrice: String(it.unitPrice ?? 0),
        taxRate: String(it.taxRate ?? 0),
      })),
    });
    if (!o.items?.length) setForm((f) => ({ ...f, items: [{ ...EMPTY_ITEM }] }));
    setFormError(null);
    setFormOpen(true);
  }

  async function openDetail(o) {
    setDetail(null);
    try {
      setDetail(await ordersApi.get(o.id));
    } catch (e) {
      setError(e.message);
    }
  }

  async function openConvert() {
    setConvertOpen(true);
    setConvertId('');
    setFormError(null);
    try {
      const res = await quotationsApi.list({ status: 'Accepted', pageSize: 100 });
      setQuotations(res.data);
    } catch (e) {
      setError(e.message);
    }
  }

  async function doConvert() {
    if (!convertId) return;
    setConverting(true);
    setError(null);
    try {
      await ordersApi.convert({ quotationId: Number(convertId) });
      setMessage('Quotation converted to order.');
      setConvertOpen(false);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setConverting(false);
    }
  }

  function update(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  function updateItem(idx, key) {
    return (e) =>
      setForm((f) => {
        const items = f.items.map((it, i) => (i === idx ? { ...it, [key]: e.target.value } : it));
        return { ...f, items };
      });
  }

  function applyProduct(idx, productId) {
    setForm((f) => {
      const items = f.items.map((it, i) => {
        if (i !== idx) return it;
        const p = productById[Number(productId)];
        if (!p) return { ...it, productId, name: '', unit: '', unitPrice: '0', taxRate: '0' };
        return {
          ...it,
          productId,
          name: p.name,
          unit: p.unit || '',
          unitPrice: String(p.unitPrice ?? 0),
          taxRate: String(p.taxRate ?? 0),
        };
      });
      return { ...f, items };
    });
  }

  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }));
  }

  function removeItem(idx) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        customerId: Number(form.customerId),
        status: form.status,
        discount: Number(form.discount) || 0,
        notes: form.notes || null,
        items: form.items.map((it) => ({
          productId: it.productId ? Number(it.productId) : null,
          name: it.name,
          unit: it.unit || null,
          quantity: Number(it.quantity) || 1,
          unitPrice: Number(it.unitPrice) || 0,
          taxRate: Number(it.taxRate) || 0,
        })),
      };
      if (editing) {
        await ordersApi.update(editing.id, payload);
        setMessage('Order updated.');
      } else {
        await ordersApi.create(payload);
        setMessage('Order created.');
      }
      setFormOpen(false);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(o) {
    if (!window.confirm(`Delete order ${o.orderNo}? This cannot be undone.`)) return;
    setError(null);
    try {
      await ordersApi.remove(o.id);
      setMessage('Order deleted.');
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sales Orders</h1>
          <p className="mt-1 text-sm text-slate-500">Create and manage sales orders.</p>
        </div>
        <div className="flex gap-2">
          {can(user, 'orders:create') && (
            <button type="button" className="btn-secondary" onClick={openConvert}>
              <ArrowRightLeft className="h-4 w-4" /> Convert quotation
            </button>
          )}
          {can(user, 'orders:create') && (
            <button type="button" className="btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> New order
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <Card className="p-0">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner className="h-8 w-8 text-brand-600" />
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-sm text-slate-500">
            <ShoppingCart className="h-8 w-8 text-slate-300" />
            <p>No orders found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 font-semibold">Order</th>
                  <th className="px-5 py-3 font-semibold">Customer</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Total</th>
                  <th className="px-5 py-3 font-semibold">Assigned</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{o.orderNo}</p>
                      <p className="text-xs text-slate-400">
                        {o.quotationNo ? `From ${o.quotationNo}` : o.createdAt?.slice(0, 10)}
                      </p>
                    </td>
                    <td className="px-5 py-3 text-slate-700">{o.customerName || '—'}</td>
                    <td className="px-5 py-3">
                      <Badge tone={STATUS_TONE[o.status] || 'slate'}>{o.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-slate-700">{fmt(o.total)}</td>
                    <td className="px-5 py-3 text-slate-600">{o.assignedName || '—'}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" className="btn-ghost px-2 py-1" title="View" onClick={() => openDetail(o)}>
                          <Eye className="h-4 w-4" />
                        </button>
                        {can(user, 'orders:edit') && (
                          <button type="button" className="btn-ghost px-2 py-1" title="Edit" onClick={() => openEdit(o)}>
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        {can(user, 'orders:delete') && (
                          <button type="button" className="btn-ghost px-2 py-1" title="Delete" onClick={() => confirmDelete(o)}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={formOpen}
        title={editing ? `Edit ${editing.orderNo}` : 'New order'}
        onClose={() => setFormOpen(false)}
        wide
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : editing ? 'Save changes' : 'Create order'}
            </button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="oCustomer">Customer</label>
              <select id="oCustomer" className="input" value={form.customerId} onChange={update('customerId')} required>
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="oStatus">Status</label>
              <select id="oStatus" className="input" value={form.status} onChange={update('status')}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="oDiscount">Discount</label>
              <input id="oDiscount" className="input" type="number" min="0" step="0.01" value={form.discount} onChange={update('discount')} />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
              <p className="text-sm font-medium text-slate-700">Line items</p>
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={addItem}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add item
              </button>
            </div>
            <div className="space-y-3 p-4">
              {form.items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 items-end gap-2">
                  <div className="col-span-12 sm:col-span-3">
                    <label className="label">Product</label>
                    <select className="input" value={it.productId} onChange={(e) => applyProduct(idx, e.target.value)}>
                      <option value="">Manual item</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-12 sm:col-span-4">
                    <label className="label">Description</label>
                    <input className="input" value={it.name} onChange={updateItem(idx, 'name')} required />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <label className="label">Unit</label>
                    <input className="input" value={it.unit} onChange={updateItem(idx, 'unit')} placeholder="pcs" />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <label className="label">Qty</label>
                    <input className="input" type="number" min="0.01" step="any" value={it.quantity} onChange={updateItem(idx, 'quantity')} />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <label className="label">Unit price</label>
                    <input className="input" type="number" min="0" step="0.01" value={it.unitPrice} onChange={updateItem(idx, 'unitPrice')} />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <label className="label">Tax %</label>
                    <input className="input" type="number" min="0" max="100" step="0.01" value={it.taxRate} onChange={updateItem(idx, 'taxRate')} />
                  </div>
                  <div className="col-span-8 sm:col-span-1 flex justify-end">
                    <button type="button" className="btn-ghost px-2 py-1" title="Remove" onClick={() => removeItem(idx)}>
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-1 border-t border-slate-100 px-4 py-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span><span>{fmt(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Tax</span><span>{fmt(totals.taxAmount)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Discount</span><span>-{fmt(form.discount)}</span>
              </div>
              <div className="flex justify-between font-semibold text-slate-900">
                <span>Total</span><span>{fmt(totals.total)}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="oNotes">Notes</label>
            <textarea id="oNotes" className="input" rows={2} value={form.notes} onChange={update('notes')} />
          </div>

          {formError && <p className="text-sm text-rose-600">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={convertOpen}
        title="Convert quotation to order"
        onClose={() => setConvertOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConvertOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={doConvert} disabled={!convertId || converting}>
              {converting ? <Spinner className="h-4 w-4" /> : 'Convert to order'}
            </button>
          </>
        }
      >
        <div className="space-y-2">
          <p className="text-sm text-slate-500">Select an accepted quotation to convert into a sales order.</p>
          <select className="input" value={convertId} onChange={(e) => setConvertId(e.target.value)}>
            <option value="">Select quotation…</option>
            {quotations.map((q) => (
              <option key={q.id} value={q.id}>
                {q.quotationNo} — {q.customerName} ({fmt(q.total)})
              </option>
            ))}
          </select>
          {quotations.length === 0 && <p className="text-xs text-slate-400">No accepted quotations available.</p>}
        </div>
      </Modal>

      <Modal open={!!detail} title={detail?.orderNo || 'Order'} onClose={() => setDetail(null)} wide>
        {!detail ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-900">{detail.customerName}</p>
                <p className="text-xs text-slate-500">
                  {detail.quotationNo ? `Converted from ${detail.quotationNo}` : detail.customerNo}
                </p>
              </div>
              <Badge tone={STATUS_TONE[detail.status] || 'slate'}>{detail.status}</Badge>
            </div>

            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 font-semibold">Item</th>
                  <th className="py-2 text-right font-semibold">Qty</th>
                  <th className="py-2 text-right font-semibold">Unit price</th>
                  <th className="py-2 text-right font-semibold">Tax</th>
                  <th className="py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {detail.items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-2 text-slate-700">{it.name}</td>
                    <td className="py-2 text-right text-slate-600">{it.quantity}</td>
                    <td className="py-2 text-right text-slate-600">{fmt(it.unitPrice)}</td>
                    <td className="py-2 text-right text-slate-600">{it.taxRate}%</td>
                    <td className="py-2 text-right text-slate-700">{fmt(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="ml-auto max-w-xs space-y-1 text-sm">
              <div className="flex justify-between text-slate-600"><span>Subtotal</span><span>{fmt(detail.subtotal)}</span></div>
              <div className="flex justify-between text-slate-600"><span>Tax</span><span>{fmt(detail.taxAmount)}</span></div>
              <div className="flex justify-between text-slate-600"><span>Discount</span><span>-{fmt(detail.discount)}</span></div>
              <div className="flex justify-between font-semibold text-slate-900"><span>Total</span><span>{fmt(detail.total)}</span></div>
            </div>

            {detail.notes && <p className="text-sm text-slate-600">{detail.notes}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
