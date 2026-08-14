import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-6xl font-bold text-brand-600">404</p>
      <h1 className="mt-4 text-xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-2 text-sm text-slate-500">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link to="/" className="btn-primary mt-6">Back to Dashboard</Link>
    </div>
  );
}
