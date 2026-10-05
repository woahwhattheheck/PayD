import { HelpCircle, House, Users, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';

const destinations = [
  { to: '/', label: 'Home', icon: House },
  { to: '/payroll', label: 'Payroll', icon: Wallet },
  { to: '/employee', label: 'Employees', icon: Users },
  { to: '/help', label: 'Help', icon: HelpCircle },
];

export default function NotFound() {
  return (
    <section className="min-h-[60vh] flex items-center justify-center py-8">
      <div className="card glass noise w-full max-w-2xl p-8 text-center">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-(--accent) mb-3">
          404
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight mb-3">Page not found</h1>
        <p className="text-(--muted) max-w-lg mx-auto mb-8">
          The page you requested does not exist. Choose a section below to get back on track.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {destinations.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center justify-center gap-3 rounded-xl border border-(--border) bg-(--surface) px-4 py-3 font-semibold text-(--text) transition-colors hover:bg-(--surface-hi)"
            >
              <Icon className="h-5 w-5 text-(--accent)" />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
