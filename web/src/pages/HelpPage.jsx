import { Link } from 'react-router-dom';
import {
  BookOpen,
  Users,
  Settings,
  CreditCard,
  ShieldCheck,
  Rocket,
  UserPlus,
  FolderKanban,
  LifeBuoy,
  ChevronRight,
} from 'lucide-react';
import { useAuth, can } from '../context/AuthContext.jsx';
import Card from '../components/ui/Card.jsx';

const FAQS = [
  {
    q: 'How do I invite my team?',
    a: 'Open Users and choose "Invite". Enter each teammate\'s email and role; they will receive an invitation link to set their own password.',
  },
  {
    q: 'How do I change or upgrade my plan?',
    a: 'Go to Billing, where you can compare plans, change your current plan, review invoices and update your billing cycle.',
  },
  {
    q: 'Where do I manage my company profile?',
    a: 'In Settings you can update your company name, contact details, currency, timezone and branding.',
  },
  {
    q: 'How do I update my password?',
    a: 'Open Profile and use the "Change password" section. You will need your current password to set a new one.',
  },
  {
    q: 'Who can see my data?',
    a: 'Visibility follows your role and permissions. Each salesperson sees their own records; managers see their teams; company admins see the whole workspace.',
  },
];

export default function HelpPage() {
  const { user } = useAuth();

  const showUsers = can(user, 'users:view');
  const showTeams = can(user, 'sales_team:view');
  const showSettings = can(user, 'settings:view');
  const showBilling = can(user, 'billing:view');
  const showLeads = can(user, 'leads:view');
  const showPipeline = can(user, 'pipeline:view');

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Help &amp; Support</h1>
        <p className="mt-1 text-sm text-slate-500">Guides and answers for getting the most out of your workspace.</p>
      </div>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          <Rocket className="h-4 w-4" /> Getting started
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {showLeads && (
            <GuideLink icon={UserPlus} title="Add your first lead" text="Capture a prospect to start building your pipeline." to="/leads" />
          )}
          {showPipeline && (
            <GuideLink icon={FolderKanban} title="Track your pipeline" text="Move deals through stages from New to Won." to="/pipeline" />
          )}
          {showUsers && (
            <GuideLink icon={Users} title="Invite your team" text="Add teammates and assign them roles." to="/users" />
          )}
          {showTeams && (
            <GuideLink icon={BookOpen} title="Organise your sales team" text="Group teammates into teams and territories." to="/sales-team" />
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          <Settings className="h-4 w-4" /> Account &amp; workspace
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <GuideLink icon={Settings} title="Company profile" text="Update your organisation name, contacts and branding." to="/settings" hidden={!showSettings} />
          <GuideLink icon={ShieldCheck} title="Account security" text="Change your personal details and password." to="/profile" />
          <GuideLink icon={CreditCard} title="Billing &amp; subscription" text="Review your plan, usage and payment history." to="/billing" hidden={!showBilling} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Frequently asked questions</h2>
        <div className="space-y-3">
          {FAQS.map((faq) => (
            <Card key={faq.q} className="p-5">
              <h3 className="text-sm font-semibold text-slate-900">{faq.q}</h3>
              <p className="mt-1 text-sm text-slate-500">{faq.a}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <LifeBuoy className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Still need help?</h2>
            <p className="mt-1 text-sm text-slate-500">
              For billing, access or account questions, contact your workspace administrator. If you are the administrator,
              review the Billing page for subscription options or reach out to your plan&apos;s support channel.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function GuideLink({ icon: Icon, title, text, to, hidden = false }) {
  if (hidden) return null;
  return (
    <Link to={to} className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 group-hover:bg-brand-50 group-hover:text-brand-600">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="font-medium text-slate-800">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500">{text}</p>
      </div>
      <ChevronRight className="ml-auto h-4 w-4 shrink-0 self-center text-slate-300 group-hover:text-brand-500" />
    </Link>
  );
}
