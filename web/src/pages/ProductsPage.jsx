import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Package } from 'lucide-react';
import { productsApi } from '../api/endpoints.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import Modal from '../components/ui/Modal.jsx';
import Badge from '../components/ui/Badge.jsx';

const EMPTY_FORM = {
  name: '',
  sku: '',
  category: '',
  description: '',
  unit: '',
  unitPrice: '',
  taxRate: '',
  status: 'Active',
};

const STATUS_TONE = { Active: 'green', Inactive: 'slate' };

export default function ProductsPage() {
  const { user } = useAuth();

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [search, setSearch] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async (q = '') => {
    setLoading(true);
    setError(null);
    try {
      const res = await productsApi.list({ pageSize: 100, search: q || undefined });
      setProducts(res.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(p) {
    setEditing(p);
    setForm({
      name: p.name || '',
      sku: p.sku || '',
      category: p.category || '',
      description: p.description || '',
      unit: p.unit || '',
      unitPrice: p.unitPrice ?? '',
      taxRate: p.taxRate ?? '',
      status: p.status || 'Active',
    });
    setFormError(null);
    setFormOpen(true);
  }

  function update(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: form.name,
        sku: form.sku || null,
        category: form.category || null,
        description: form.description || null,
        unit: form.unit || null,
        unitPrice: form.unitPrice === '' ? 0 : Number(form.unitPrice),
        taxRate: form.taxRate === '' ? 0 : Number(form.taxRate),
        status: form.status,
      };
      if (editing) {
        await productsApi.update(editing.id, payload);
        setMessage('Product updated.');
      } else {
        await productsApi.create(payload);
        setMessage('Product created.');
      }
      setFormOpen(false);
      load(search);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(p) {
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    setDeleting(p.id);
    setError(null);
    try {
      await productsApi.remove(p.id);
      setMessage('Product deleted.');
      load(search);
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  }

  function onSearch(e) {
    e.preventDefault();
    load(search);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Products</h1>
          <p className="mt-1 text-sm text-slate-500">Manage your product and service catalogue.</p>
        </div>
        {can(user, 'products:create') && (
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add product
          </button>
        )}
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <Card className="p-0">
        <form onSubmit={onSearch} className="flex items-center gap-2 border-b border-slate-100 p-4">
          <input
            className="input max-w-xs"
            placeholder="Search name, SKU or category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="btn-secondary">Search</button>
        </form>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner className="h-8 w-8 text-brand-600" />
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-sm text-slate-500">
            <Package className="h-8 w-8 text-slate-300" />
            <p>No products found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 font-semibold">Product</th>
                  <th className="px-5 py-3 font-semibold">Category</th>
                  <th className="px-5 py-3 font-semibold">Unit</th>
                  <th className="px-5 py-3 text-right font-semibold">Unit price</th>
                  <th className="px-5 py-3 text-right font-semibold">Tax</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{p.name}</p>
                      <p className="text-xs text-slate-400">{p.sku ? p.sku : p.productNo}</p>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{p.category || '—'}</td>
                    <td className="px-5 py-3 text-slate-600">{p.unit || '—'}</td>
                    <td className="px-5 py-3 text-right text-slate-700">
                      {new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(p.unitPrice)}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">{p.taxRate}%</td>
                    <td className="px-5 py-3">
                      <Badge tone={STATUS_TONE[p.status] || 'slate'}>{p.status}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {can(user, 'products:edit') && (
                          <button type="button" className="btn-ghost px-2 py-1" title="Edit" onClick={() => openEdit(p)}>
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        {can(user, 'products:delete') && (
                          <button type="button" className="btn-ghost px-2 py-1" title="Delete" onClick={() => confirmDelete(p)}>
                            {deleting === p.id ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
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
        title={editing ? 'Edit product' : 'Add product'}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : editing ? 'Save changes' : 'Add product'}
            </button>
          </>
        }
      >
        <form onSubmit={save} className="grid grid-cols-1 gap-4">
          <div>
            <label className="label" htmlFor="productName">Name</label>
            <input id="productName" className="input" value={form.name} onChange={update('name')} required />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="productSku">SKU</label>
              <input id="productSku" className="input" value={form.sku} onChange={update('sku')} />
            </div>
            <div>
              <label className="label" htmlFor="productCategory">Category</label>
              <input id="productCategory" className="input" value={form.category} onChange={update('category')} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="productUnit">Unit</label>
              <input id="productUnit" className="input" value={form.unit} onChange={update('unit')} placeholder="e.g. pcs" />
            </div>
            <div>
              <label className="label" htmlFor="productPrice">Unit price</label>
              <input id="productPrice" className="input" type="number" min="0" step="0.01" value={form.unitPrice} onChange={update('unitPrice')} />
            </div>
            <div>
              <label className="label" htmlFor="productTax">Tax rate (%)</label>
              <input id="productTax" className="input" type="number" min="0" max="100" step="0.01" value={form.taxRate} onChange={update('taxRate')} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="productStatus">Status</label>
            <select id="productStatus" className="input" value={form.status} onChange={update('status')}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="productDesc">Description</label>
            <textarea id="productDesc" className="input" rows={2} value={form.description} onChange={update('description')} />
          </div>
          {formError && <p className="text-sm text-rose-600">{formError}</p>}
        </form>
      </Modal>
    </div>
  );
}
