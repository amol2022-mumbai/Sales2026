import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, UserPlus, CheckCircle2 } from 'lucide-react';
import { companyApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Spinner from '../components/ui/Spinner.jsx';

const STEPS = ['Welcome', 'Company profile', 'Basic settings', 'Team & users'];

export default function OnboardingPage() {
  const { user, tenant, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!tenant) return;
    setForm({
      name: tenant.name || '',
      email: tenant.email || '',
      phone: tenant.phone || '',
      website: tenant.website || '',
      address: tenant.address || '',
      city: tenant.city || '',
      state: tenant.state || '',
      country: tenant.country || '',
      postalCode: tenant.postalCode || '',
      currency: tenant.currency || 'USD',
      timezone: tenant.timezone || 'UTC',
      brandColor: tenant.brandColor || '#4f46e5',
    });
  }, [tenant]);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      await companyApi.completeSetup(tenant.companyId, form);
      await refreshUser();
      navigate('/', { replace: true });
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50">
          <Building2 className="h-6 w-6 text-brand-600" />
        </div>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">Welcome to {tenant?.name || 'your workspace'}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Hi {user?.name?.split(' ')[0] || 'there'}, let&apos;s set up your workspace in a few quick steps.
        </p>
      </div>

      <div className="flex justify-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                i <= step ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500'
              }`}
            >
              {i < step ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </div>
            <span className={`hidden text-xs sm:inline ${i === step ? 'font-semibold text-slate-800' : 'text-slate-400'}`}>{label}</span>
            {i < STEPS.length - 1 && <div className="hidden h-px w-8 bg-slate-200 sm:block" />}
          </div>
        ))}
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {step === 0 && (
        <Card className="p-8 text-center">
          <h2 className="text-lg font-semibold text-slate-900">Let&apos;s get you started</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            We&apos;ll guide you through completing your company profile, choosing basic settings, and inviting your team.
          </p>
          <button type="button" className="btn-primary mt-6" onClick={() => setStep(1)}>
            Start setup
          </button>
        </Card>
      )}

      {step === 1 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-slate-900">Company profile</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Company name</label>
              <input className="input" value={form.name || ''} onChange={update('name')} />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" value={form.email || ''} onChange={update('email')} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone || ''} onChange={update('phone')} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Website</label>
              <input className="input" value={form.website || ''} onChange={update('website')} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Address</label>
              <input className="input" value={form.address || ''} onChange={update('address')} />
            </div>
            <div>
              <label className="label">City</label>
              <input className="input" value={form.city || ''} onChange={update('city')} />
            </div>
            <div>
              <label className="label">State / Region</label>
              <input className="input" value={form.state || ''} onChange={update('state')} />
            </div>
            <div>
              <label className="label">Country</label>
              <input className="input" value={form.country || ''} onChange={update('country')} />
            </div>
            <div>
              <label className="label">Postal code</label>
              <input className="input" value={form.postalCode || ''} onChange={update('postalCode')} />
            </div>
          </div>
          <div className="mt-5 flex justify-between">
            <button type="button" className="btn-secondary" onClick={() => setStep(0)}>Back</button>
            <button type="button" className="btn-primary" disabled={!form.name} onClick={() => setStep(2)}>Next</button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-slate-900">Basic settings</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Currency</label>
              <select className="input" value={form.currency || 'USD'} onChange={update('currency')}>
                {['USD', 'EUR', 'GBP', 'INR', 'AED', 'SAR', 'JPY', 'AUD'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Timezone</label>
              <input className="input" value={form.timezone || ''} onChange={update('timezone')} placeholder="UTC" />
            </div>
            <div>
              <label className="label">Brand colour</label>
              <input type="color" className="h-10 w-full cursor-pointer rounded-lg border border-slate-300 p-1" value={form.brandColor || '#4f46e5'} onChange={update('brandColor')} />
            </div>
          </div>
          <div className="mt-5 flex justify-between">
            <button type="button" className="btn-secondary" onClick={() => setStep(1)}>Back</button>
            <button type="button" className="btn-primary" onClick={() => setStep(3)}>Next</button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-slate-900">Team &amp; users</h2>
          <p className="mt-1 text-sm text-slate-500">
            You can invite teammates and organise your sales team now, or skip and do it later from Settings.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button type="button" className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 text-left hover:border-brand-300" onClick={() => navigate('/users')}>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50">
                <UserPlus className="h-5 w-5 text-brand-600" />
              </div>
              <div>
                <p className="font-medium text-slate-800">Invite users</p>
                <p className="text-xs text-slate-500">Add your team members</p>
              </div>
            </button>
            <button type="button" className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 text-left hover:border-brand-300" onClick={() => navigate('/sales-team')}>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50">
                <Users className="h-5 w-5 text-brand-600" />
              </div>
              <div>
                <p className="font-medium text-slate-800">Create sales team</p>
                <p className="text-xs text-slate-500">Organise teams and territories</p>
              </div>
            </button>
          </div>
          <div className="mt-5 flex items-center justify-between">
            <button type="button" className="btn-secondary" onClick={() => setStep(2)}>Back</button>
            <button type="button" className="btn-primary" disabled={saving} onClick={finish}>
              {saving ? <Spinner className="h-4 w-4" /> : 'Finish setup'}
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
