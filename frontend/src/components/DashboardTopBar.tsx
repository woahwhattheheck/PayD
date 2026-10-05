import React from 'react';
import ThemeToggle from './ThemeToggle';
import ConnectAccount from './ConnectAccount';
import { Text } from '@stellar/design-system';
import { useAuth } from '../providers/AuthProvider';

export const DashboardTopBar: React.FC = () => {
  const { user, loading } = useAuth();
  const balance = '1,250.45 USDC';

  return (
    <header className="h-16 px-8 border-b border-(--border) bg-(--bg)/80 backdrop-blur-xl flex items-center justify-between sticky top-0 z-40">
      <div className="flex items-center gap-6">
        <div className="hidden lg:flex flex-col">
          <Text
            as="span"
            size="xs"
            weight="bold"
            addlClassName="text-(--muted) uppercase tracking-widest text-[10px]"
          >
            Organization
          </Text>
          {loading ? (
            <span
              aria-label="Loading organization"
              className="mt-1 h-4 w-28 rounded bg-(--surface-hi) animate-pulse"
            />
          ) : (
            <Text as="span" size="sm" weight="bold" addlClassName="text-(--text)">
              {user?.organizationName ?? 'No organization'}
            </Text>
          )}
        </div>

        <div className="w-px h-6 bg-(--border) hidden lg:block" />

        <div className="flex flex-col">
          <Text
            as="span"
            size="xs"
            weight="bold"
            addlClassName="text-(--muted) uppercase tracking-widest text-[10px]"
          >
            Available Balance
          </Text>
          <Text as="span" size="sm" weight="bold" addlClassName="text-(--accent) font-mono">
            {balance}
          </Text>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <ThemeToggle />
        <div className="w-px h-6 bg-(--border) mx-2" />
        <ConnectAccount />
      </div>
    </header>
  );
};
