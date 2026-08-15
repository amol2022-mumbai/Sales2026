import { useCallback, useEffect, useState } from 'react';
import { CreditCard, RefreshCw, Check, X, AlertTriangle, Users, Database, Zap, Download } from 'lucide-react';
import { billingApi } from '../api/endpoints.js';
import { useAuth, can } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import Spinner from '../components/ui/Spinner.jsx';

const STATUS_TONES = { active: 'green', trial: 'indigo', expiring: 'sky', expired: 'rose', suspended: 'amber', cancelled: 'slate', past_due: 'amber' };

function currency(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
}

function fmtCycle(cycle) {
  return cycle === 'annual' ? 'Annual' : 'Monthly';
}

export default function BillingPage() {
  const { user } = useAuth();
  const canEdit = can(user, 'billing:edit');

  const [summary, setSummary] = useState(null);
  const [plans, setPlans] = useState([]);
  const [usage, setUsage] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const [planId, setPlanId] = useState('');
  const [cycle, setCycle] = useState('monthly');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, p, u, i, pay] = await Promise.all([
        billingApi.get(),
        billingApi.plans(),
        billingApi.usage(),
        billingApi.invoices(),
        billingApi.payments(),
      ]);
      setSummary(s);
      setPlans(p);
      setUsage(u);
      setInvoices(i);
      setPayments(pay);
      setPlanId(s.planId ? String(s.planId) : '');
      setCycle(s.billingCycle || 'monthly');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action, arg) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action(arg);
      setNotice('Billing updated.');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const changePlan = () => run((_) => billingApi.changePlan({ planId: Number(planId), billingCycle: cycle }), null);
  const renew = () => run((_) => billingApi.renew({ billingCycle: cycle }), null);
  const cancel = () => run((_) => billingApi.cancel(), null);
  const reactivate = () => run((_) => billingApi.reactivate(), null);
  const payNow = (invoiceId) => run((_) => billingApi.mockPay(invoiceId), null);

  function selectPlan(p) {
    setPlanId(String(p.id));
    setCycle(p.priceAnnual > 0 ? cycle : 'monthly');
    document.getElementById('change-plan')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  const selectedPlan = plans.find((p) => String(p.id) === String(planId));
  const selectedPrice = selectedPlan ? (cycle === 'annual' ? selectedPlan.priceAnnual : selectedPlan.priceMonthly) : 0;
  const isPastDue = summary?.licenseStatus === 'past_due';
  const isExpired = summary?.licenseStatus === 'expired';

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Billing</h1>
          <p className="mt-1 text-sm text-slate-500">Manage your subscription, plan and payment history.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={load} disabled={loading || busy}>
          <RefreshCw className={`h-4 w-4 ${loading || busy ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      {summary && (
        <>
          {isPastDue && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Your subscription is past due.</p>
                <p>
                  A payment failed. You can keep using the service until{' '}
                  <span className="font-semibold">{summary.graceEndsAt || summary.renewalDate || 'the grace period ends'}</span>. Update your
                  payment method or renew to avoid interruption.
                </p>
              </div>
            </div>
          )}

          {isExpired && (
            <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Your subscription has expired.</p>
                <p>Renew your plan to restore access to your data and features.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Current plan</p>
                  <div className="mt-1 flex items-center gap-2">
                    <h2 className="text-xl font-semibold text-slate-900">{summary.planName || 'No plan'}</h2>
                    <Badge tone={STATUS_TONES[summary.licenseStatus] || 'slate'}>{summary.licenseStatus}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {currency(summary.currentPrice)} / {fmtCycle(summary.billingCycle)}
                    {summary.autoRenew ? ' · auto-renew on' : ' · auto-renew off'}
                  </p>
                </div>
                {canEdit && summary.licenseStatus !== 'cancelled' && (
                  <button type="button" className="btn-secondary text-rose-600 hover:bg-rose-50" onClick={cancel} disabled={busy}>
                    Cancel subscription
                  </button>
                )}
                {canEdit && summary.licenseStatus === 'cancelled' && (
                  <button type="button" className="btn-primary" onClick={reactivate} disabled={busy}>
                    Reactivate
                  </button>
                )}
                {canEdit && (isPastDue || isExpired) && (
                  <button type="button" className="btn-primary" onClick={renew} disabled={busy}>
                    <CreditCard className="h-4 w-4" /> Renew now
                  </button>
                )}
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Renews on</p>
                  <p className="mt-1 font-semibold text-slate-900">{summary.renewalDate || '—'}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Seats</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {summary.userCount}
                    {summary.userLimit > 0 ? ` / ${summary.userLimit}` : ''}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Storage</p>
                  <p className="mt-1 font-semibold text-slate-900">{summary.storageLimitMb < 0 ? 'Unlimited' : `${summary.storageLimitMb} MB`}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Modules</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {summary.modules == null ? 'All' : summary.modules.length}
                    <span className="font-normal text-slate-400"> enabled</span>
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                <FeaturePill label="Export" enabled={summary.exportEnabled} />
                <FeaturePill label="API access" enabled={summary.apiEnabled} />
                {summary.failedPayments > 0 && (
                  <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700">
                    {summary.failedPayments} failed payment(s)
                  </span>
                )}
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Included features</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(summary.features || []).map((f) => (
                    <span key={f.key} className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                      {f.label}
                    </span>
                  ))}
                  {(!summary.features || summary.features.length === 0) && <span className="text-xs text-slate-400">No modules configured.</span>}
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Totals</p>
              <div className="mt-3 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Billed</span>
                  <span className="font-semibold text-slate-900">{currency(summary.billed)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Paid</span>
                  <span className="font-semibold text-emerald-600">{currency(summary.paid)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Outstanding</span>
                  <span className="font-semibold text-rose-600">{currency(summary.outstanding)}</span>
                </div>
              </div>
            </Card>
          </div>

          {usage.length > 0 && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-slate-800">Usage</h3>
              <p className="mt-0.5 text-xs text-slate-400">Current usage against your plan limits.</p>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {usage.map((u) => (
                  <UsageMeter key={u.key} item={u} />
                ))}
              </div>
            </Card>
          )}

          {plans.length > 0 && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-slate-800">Compare plans</h3>
              <p className="mt-0.5 text-xs text-slate-400">Select a plan to upgrade or downgrade.</p>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {plans.map((p) => {
                  const current = String(p.id) === String(summary.planId);
                  return (
                    <div
                      key={p.id}
                      className={`flex flex-col rounded-lg border p-4 ${current ? 'border-brand-300 bg-brand-50/50 ring-1 ring-brand-300' : 'border-slate-200'}`}
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-slate-900">{p.name}</h4>
                        {current && <Badge tone="green">Current</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{p.description}</p>
                      <div className="mt-3">
                        <span className="text-2xl font-bold text-slate-900">{currency(p.priceMonthly)}</span>
                        <span className="text-sm text-slate-400"> / mo</span>
                      </div>
                      {p.priceAnnual > 0 && <p className="text-xs text-slate-500">{currency(p.priceAnnual)} / yr</p>}
                      <ul className="mt-3 space-y-1.5 text-xs text-slate-600">
                        <li className="flex items-center gap-2">
                          <Users className="h-3.5 w-3.5 text-slate-400" />
                          {p.userLimit < 0 ? 'Unlimited users' : `${p.userLimit} users`}
                        </li>
                        <li className="flex items-center gap-2">
                          <Database className="h-3.5 w-3.5 text-slate-400" />
                          {p.storageLimitMb < 0 ? 'Unlimited storage' : `${p.storageLimitMb} MB storage`}
                        </li>
                        <li className="flex items-center gap-2">
                          <Download className="h-3.5 w-3.5 text-slate-400" />
                          {p.exportEnabled ? 'Data export' : 'No export'}
                        </li>
                        <li className="flex items-center gap-2">
                          <Zap className="h-3.5 w-3.5 text-slate-400" />
                          {p.apiEnabled ? 'API access' : 'No API'}
                        </li>
                        {Object.entries(p.limits || {}).map(([key, limit]) => (
                          <li key={key} className="flex items-center gap-2">
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                            {limit == null || limit < 0 ? `Unlimited ${key.replace('_', ' ')}` : `${limit} ${key.replace('_', ' ')}`}
                          </li>
                        ))}
                      </ul>
                      {canEdit && !current && (
                        <button type="button" className="btn-secondary mt-4 w-full" onClick={() => selectPlan(p)} disabled={busy}>
                          Choose {p.name}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {canEdit && (
            <Card className="p-5" id="change-plan">
              <h3 className="text-sm font-semibold text-slate-800">Change plan</h3>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div>
                  <label className="label" htmlFor="plan">Plan</label>
                  <select id="plan" className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                    <option value="">Select a plan…</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="cycle">Billing cycle</label>
                  <select id="cycle" className="input" value={cycle} onChange={(e) => setCycle(e.target.value)}>
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                  </select>
                </div>
                <div className="text-sm text-slate-600">
                  {selectedPlan ? (
                    <>
                      <span className="font-semibold">{currency(selectedPrice)}</span>
                      <span className="text-slate-400"> / {fmtCycle(cycle)}</span>
                    </>
                  ) : (
                    <span className="text-slate-400">Select a plan</span>
                  )}
                </div>
                <button type="button" className="btn-primary" disabled={busy || !planId} onClick={changePlan}>
                  {busy ? <Spinner className="h-4 w-4" /> : 'Apply plan'}
                </button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={renew}>
                  Renew current plan
                </button>
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-3">
                <h3 className="text-sm font-semibold text-slate-800">Invoices</h3>
              </div>
              {invoices.length ? (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Invoice</th>
                      <th className="px-4 py-2">Amount</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-medium text-slate-700">{inv.invoiceNo}</td>
                        <td className="px-4 py-2 text-slate-600">{currency(inv.amount)}</td>
                        <td className="px-4 py-2">
                          <Badge tone={inv.status === 'Paid' ? 'green' : inv.status === 'Partial' ? 'amber' : inv.status === 'Void' ? 'slate' : 'rose'}>{inv.status}</Badge>
                        </td>
                        <td className="px-4 py-2 text-right">
                          {canEdit && inv.balance > 0 && inv.status !== 'Void' && (
                            <button type="button" className="text-sm font-medium text-brand-600 hover:text-brand-700" onClick={() => payNow(inv.id)} disabled={busy}>
                              Pay now
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-5 py-4 text-sm text-slate-400">No invoices yet.</p>
              )}
            </Card>

            <Card className="overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-3">
                <h3 className="text-sm font-semibold text-slate-800">Payments</h3>
              </div>
              {payments.length ? (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Payment</th>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Type</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payments.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-medium text-slate-700">{p.paymentNo}</td>
                        <td className="px-4 py-2 text-slate-500">{p.paymentDate}</td>
                        <td className="px-4 py-2">
                          <Badge tone={p.type === 'refund' ? 'rose' : 'green'}>{p.type}</Badge>
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-slate-700">{currency(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-5 py-4 text-sm text-slate-400">No payments yet.</p>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function FeaturePill({ label, enabled }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
      }`}
    >
      {enabled ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {label}
    </span>
  );
}

function UsageMeter({ item }) {
  const unlimited = item.limit == null;
  const pct = item.utilizationPct == null ? 0 : Math.min(100, item.utilizationPct);
  const tone = pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">{item.label}</span>
        <span className="text-xs text-slate-500">
          {unlimited ? 'Unlimited' : `${item.usage} / ${item.limit}`}
          {item.period === 'monthly' && <span className="text-slate-400"> · monthly</span>}
        </span>
      </div>
      {!unlimited && (
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
