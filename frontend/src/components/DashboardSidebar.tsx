import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Wallet,
  History,
  Settings,
  HelpCircle,
  FileText,
  Globe,
  ShieldAlert,
  Layout,
  TrendingUp,
  Receipt,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface NavItem {
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
  path: string;
}

const navItems: NavItem[] = [
  { icon: LayoutDashboard, labelKey: 'nav.dashboard', path: '/' },
  { icon: Wallet, labelKey: 'nav.payroll', path: '/payroll' },
  { icon: Users, labelKey: 'nav.employees', path: '/employee' },
  { icon: TrendingUp, labelKey: 'nav.forecast', path: '/forecast' },
  { icon: FileText, labelKey: 'nav.reports', path: '/reports' },
  { icon: Receipt, labelKey: 'nav.taxCompliance', path: '/tax-compliance' },
  { icon: Globe, labelKey: 'nav.crossAsset', path: '/cross-asset-payment' },
  { icon: History, labelKey: 'nav.history', path: '/transactions' },
  { icon: Layout, labelKey: 'nav.employeePortal', path: '/portal' },
  { icon: ShieldAlert, labelKey: 'nav.securityCenter', path: '/admin' },
  { icon: Settings, labelKey: 'nav.settings', path: '/settings' },
];

interface DashboardSidebarProps {
  onClose?: () => void;
}

export const DashboardSidebar: React.FC<DashboardSidebarProps> = ({
  onClose,
}: DashboardSidebarProps) => {
  const { t } = useTranslation();

  return (
    <aside className="h-full w-64 border-r border-(--border) bg-(--surface) flex flex-col">
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg grid place-items-center font-extrabold text-(--on-accent) text-sm tracking-tight shadow-(--shadow-sm) bg-linear-to-br from-(--accent) to-(--accent2)">
          P
        </div>
        <span className="text-xl font-extrabold tracking-tight">
          Pay<span className="text-(--accent)">D</span>
        </span>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
                isActive
                  ? 'bg-(--accent)/10 text-(--accent)'
                  : 'text-(--muted) hover:bg-(--surface-hi) hover:text-(--text)'
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            <span className="font-medium text-sm">{t(item.labelKey)}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-4 mt-auto">
        <NavLink
          to="/help"
          onClick={onClose}
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
              isActive
                ? 'bg-(--surface-hi) text-(--text)'
                : 'text-(--muted) hover:bg-(--surface-hi) hover:text-(--text)'
            }`
          }
        >
          <HelpCircle className="w-5 h-5" />
          <span className="font-medium text-sm">{t('nav.helpCenter')}</span>
        </NavLink>

        <div className="mt-4 p-4 border border-(--border) rounded-2xl bg-(--surface-hi)">
          <p className="text-[10px] text-(--muted) uppercase font-bold tracking-widest mb-2">
            {t('nav.network')}
          </p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-(--accent) animate-pulse" />
            <span className="text-xs font-mono font-medium">{t('nav.stellarTestnet')}</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
