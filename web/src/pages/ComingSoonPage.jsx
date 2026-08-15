import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function ComingSoonPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="text-2xl font-bold text-slate-900">This area isn&apos;t available</h1>
      <p className="mt-2 max-w-md text-sm text-slate-500">
        The page you&apos;re looking for is not part of your current workspace. Please check the
        navigation for available features.
      </p>
      <Link to="/" className="btn-secondary mt-8 inline-flex items-center gap-2">
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </Link>
    </div>
  );
}
