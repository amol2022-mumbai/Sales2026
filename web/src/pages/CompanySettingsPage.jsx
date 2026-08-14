import { useEffect, useState } from 'react';
import { companyApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Spinner from '../components/ui/Spinner.jsx';

const EMPTY = {
  name: '',
  email: '',
  phone: '',
  website: '',
  address: '',
  city: '',
  state: '',
  country: '',
  postalCode: '',
  currency: 'USD',
  timezone: 'UTC',
  logoUrl: '',
  faviconUrl: '',
  brandColor: '#4f46e5',
};

export default function CompanySettingsPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    companyApi
      .list()
      .then((list) => {
        if (!active) return;
        setCompanies(list);
        const initial = list[0];
        if (initial) {
          setSelectedId(initial.id);
          setForm({
            name: initial.name || '',
            email: initial.email || '',
            phone: initial.phone || '',
            website: initial.website || '',
            address: initial.address || '',
            city: initial.city || '',
            state: initial.state || '',
            country: initial.country || '',
            postalCode: initial.postalCode || '',
            currency: initial.currency || 'USD',
            timezone: initial.timezone || 'UTC',
            logoUrl: initial.logoUrl || '',
            faviconUrl: initial.faviconUrl || '',
            brandColor: initial.brandColor || '#4f46e5',
          });
        }
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  function selectCompany(id) {
    const c = companies.find((x) => x.id === id);
    if (!c) return;
    setSelectedId(id);
    setForm({
      name: c.name || '',
      email: c.email || '',
      phone: c.phone || '',
      website: c.website || '',
      address: c.address || '',
      city: c.city || '',
      state: c.state || '',
      country: c.country || '',
      postalCode: c.postalCode || '',
      currency: c.currency || 'USD',
      timezone: c.timezone || 'UTC',
      logoUrl: c.logoUrl || '',
      faviconUrl: c.faviconUrl || '',
      brandColor: c.brandColor || '#4f46e5',
    });
    setMessage(null);
    setError(null);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await companyApi.update(selectedId, form);
      setCompanies((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setMessage('Company settings saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Company Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Configure your organization&apos;s profile and preferences.</p>
      </div>

      {error && !selectedId && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {user?.isSuperAdmin && companies.length > 1 && (
        <Card className="p-4">
          <label className="label" htmlFor="company">Company</label>
          <select id="company" className="input" value={selectedId || ''} onChange={(e) => selectCompany(Number(e.target.value))}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Card>
      )}

      <Card className="p-6">
        <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="name">Company name</label>
            <input id="name" className="input" value={form.name} onChange={update('name')} required />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" className="input" value={form.email} onChange={update('email')} />
          </div>
          <div>
            <label className="label" htmlFor="phone">Phone</label>
            <input id="phone" className="input" value={form.phone} onChange={update('phone')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="website">Website</label>
            <input id="website" className="input" value={form.website} onChange={update('website')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="address">Address</label>
            <input id="address" className="input" value={form.address} onChange={update('address')} />
          </div>
          <div>
            <label className="label" htmlFor="city">City</label>
            <input id="city" className="input" value={form.city} onChange={update('city')} />
          </div>
          <div>
            <label className="label" htmlFor="state">State / Region</label>
            <input id="state" className="input" value={form.state} onChange={update('state')} />
          </div>
          <div>
            <label className="label" htmlFor="country">Country</label>
            <input id="country" className="input" value={form.country} onChange={update('country')} />
          </div>
          <div>
            <label className="label" htmlFor="postalCode">Postal code</label>
            <input id="postalCode" className="input" value={form.postalCode} onChange={update('postalCode')} />
          </div>
          <div>
            <label className="label" htmlFor="currency">Currency</label>
            <select id="currency" className="input" value={form.currency} onChange={update('currency')}>
              {['USD', 'EUR', 'GBP', 'INR', 'AED', 'SAR', 'JPY', 'AUD'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="timezone">Timezone</label>
            <input id="timezone" className="input" value={form.timezone} onChange={update('timezone')} />
          </div>

          <div>
            <label className="label" htmlFor="brandColor">Brand colour</label>
            <input id="brandColor" type="color" className="h-10 w-full cursor-pointer rounded-lg border border-slate-300 p-1" value={form.brandColor} onChange={update('brandColor')} />
          </div>
          <div>
            <label className="label" htmlFor="logoUrl">Logo URL</label>
            <input id="logoUrl" className="input" placeholder="https://…/logo.png" value={form.logoUrl} onChange={update('logoUrl')} />
          </div>
          <div>
            <label className="label" htmlFor="faviconUrl">Favicon URL</label>
            <input id="faviconUrl" className="input" placeholder="https://…/favicon.ico" value={form.faviconUrl} onChange={update('faviconUrl')} />
          </div>

          <div className="sm:col-span-2">
            {message && <p className="mb-2 text-sm text-emerald-600">{message}</p>}
            {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <Spinner className="h-4 w-4" /> : 'Save settings'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
