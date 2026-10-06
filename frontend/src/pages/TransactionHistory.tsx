import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Calendar, Filter, Search } from 'lucide-react';
import {
  fetchHistoryPage,
  type HistoryFilters,
  type TimelineItem,
} from '../services/transactionHistory.js';
import { CertificateDownloadButton } from '../components/CertificateDownloadButton.js';

const DEFAULT_FILTERS: HistoryFilters = {
  search: '',
  status: '',
  employee: '',
  asset: '',
  startDate: '',
  endDate: '',
};

function getStatusClass(status: string): string {
  if (status === 'confirmed' || status === 'indexed') {
    return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
  }
  if (status === 'pending') {
    return 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20';
  }
  return 'bg-red-500/10 text-red-400 border border-red-500/20';
}

function TimelineSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3, 4, 5].map((val) => (
        <div
          key={`skeleton-${val}`}
          className="animate-pulse rounded-xl border border-(--border) p-4"
        >
          <div className="h-3 w-40 bg-(--surface-hi) rounded mb-2" />
          <div className="h-3 w-64 bg-(--surface-hi) rounded mb-2" />
          <div className="h-3 w-28 bg-(--surface-hi) rounded" />
        </div>
      ))}
    </div>
  );
}

export default function TransactionHistory() {
  const { t, i18n } = useTranslation();
  const [filters, setFilters] = useState<HistoryFilters>(DEFAULT_FILTERS);
  const [debouncedFilters, setDebouncedFilters] = useState<HistoryFilters>(DEFAULT_FILTERS);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedFilters(filters);
      setPage(1);
    }, 350);

    return () => {
      clearTimeout(timeout);
    };
  }, [filters]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result: { items: TimelineItem[]; hasMore: boolean } = await fetchHistoryPage({
          page: 1,
          limit: 20,
          filters: debouncedFilters,
        });
        setItems(result.items);
        setHasMore(result.hasMore);
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : t('transactionHistory.loadFailed')
        );
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [debouncedFilters, t]);

  const activeFilterCount = useMemo(
    () => (Object.values(filters) as string[]).filter((value) => value.trim().length > 0).length,
    [filters]
  );

  const loadMore = async () => {
    const nextPage = page + 1;
    setIsLoadingMore(true);
    try {
      const result: { items: TimelineItem[]; hasMore: boolean } = await fetchHistoryPage({
        page: nextPage,
        limit: 20,
        filters: debouncedFilters,
      });
      setItems((prev: TimelineItem[]) => [...prev, ...result.items]);
      setPage(nextPage);
      setHasMore(result.hasMore);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('transactionHistory.loadMoreFailed'));
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 lg:p-12 max-w-7xl mx-auto w-full">
      <div className="mb-6 sm:mb-8 flex flex-col md:flex-row md:items-end justify-between border-b border-(--border) pb-4 sm:pb-6 gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black mb-2 tracking-tight">
            {t('transactionHistory.titlePrefix')} <span className="text-accent">{t('transactionHistory.titleHighlight')}</span>
          </h1>
          <p className="text-(--muted) font-mono text-xs sm:text-sm tracking-wider uppercase">
            {t('transactionHistory.subtitle')}
          </p>
        </div>
        <button
          onClick={() => setShowFilters((prev) => !prev)}
          className="px-4 py-3 rounded-lg font-bold flex items-center justify-center gap-2 bg-(--surface-hi) text-(--text) hover:bg-(--border) transition-all touch-manipulation min-h-[44px] text-sm sm:text-base"
        >
          <Filter size={18} />
          {t('transactionHistory.filters')} {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
        </button>
      </div>

      {showFilters && (
        <div className="bg-[#16161a] border border-(--border) rounded-xl p-4 sm:p-6 mb-4 sm:mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-(--muted) w-4 h-4" />
              <input
                value={filters.search}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, search: event.target.value }))
                }
                placeholder={t('transactionHistory.searchPlaceholder')}
                className="w-full bg-[#0a0a0c] border border-(--border) rounded-lg py-2.5 pl-10 pr-4 text-sm"
              />
            </div>

            <select
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
              className="bg-[#0a0a0c] border border-(--border) rounded-lg px-3 py-2.5 text-sm"
            >
              <option value="">{t('transactionHistory.allStatuses')}</option>
              <option value="confirmed">{t('transactionHistory.confirmed')}</option>
              <option value="pending">{t('transactionHistory.pending')}</option>
              <option value="failed">{t('transactionHistory.failed')}</option>
            </select>

            <input
              value={filters.employee}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, employee: event.target.value }))
              }
              placeholder={t('transactionHistory.employeePlaceholder')}
              className="bg-[#0a0a0c] border border-(--border) rounded-lg px-3 py-2.5 text-sm"
            />

            <input
              value={filters.asset}
              onChange={(event) => setFilters((prev) => ({ ...prev, asset: event.target.value }))}
              placeholder={t('transactionHistory.assetPlaceholder')}
              className="bg-[#0a0a0c] border border-(--border) rounded-lg px-3 py-2.5 text-sm"
            />

            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-(--muted) w-4 h-4" />
              <input
                type="date"
                value={filters.startDate}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, startDate: event.target.value }))
                }
                className="w-full bg-[#0a0a0c] border border-(--border) rounded-lg py-2.5 pl-10 pr-4 text-sm"
              />
            </div>

            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-(--muted) w-4 h-4" />
              <input
                type="date"
                value={filters.endDate}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, endDate: event.target.value }))
                }
                className="w-full bg-[#0a0a0c] border border-(--border) rounded-lg py-2.5 pl-10 pr-4 text-sm"
              />
            </div>
          </div>
        </div>
      )}

      <div className="bg-[#16161a] border border-(--border) rounded-xl p-3 sm:p-5 flex-1">
        {error ? <p className="text-xs sm:text-sm text-red-400 mb-4 p-2">{error}</p> : null}
        {isLoading ? <TimelineSkeleton /> : null}

        {!isLoading && items.length === 0 ? (
          <div className="text-(--muted) text-center py-12 sm:py-16">
            <Activity className="w-6 h-6 sm:w-8 sm:h-8 opacity-30 mx-auto mb-3" />
            <p className="text-xs sm:text-sm">{t('transactionHistory.empty')}</p>
          </div>
        ) : null}

        {!isLoading && items.length > 0 ? (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-(--border) p-3 sm:p-4 hover:bg-(--surface-hi) transition-colors"
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] border border-(--border-hi) text-(--text)">
                    {item.badge}
                  </span>
                  <span
                    className={`px-2 sm:px-2.5 py-1 rounded-md text-[10px] sm:text-[11px] font-bold uppercase ${getStatusClass(item.status)}`}
                  >
                    {t(`transactionHistory.status.${item.status}`, { defaultValue: item.status })}
                  </span>
                  <span className="text-[10px] sm:text-xs text-(--muted)">
                    {new Date(item.createdAt).toLocaleString(i18n.language)}
                  </span>
                </div>
                <p className="text-xs sm:text-sm font-semibold mb-1">{item.label}</p>
                <p className="text-[10px] sm:text-xs text-(--muted)">{t('transactionHistory.actor')} {item.actor}</p>
                <p className="text-[10px] sm:text-xs text-(--muted)">
                  {t('transactionHistory.amountLabel')} {item.amount} {item.asset}
                </p>
                {item.txHash ? (
                  <>
                    <p className="text-[10px] sm:text-xs text-blue-400 font-mono mt-1 break-all">
                      {item.txHash}
                    </p>
                    <div className="mt-2 flex justify-end">
                      <CertificateDownloadButton transactionHash={item.txHash} />
                    </div>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {!isLoading && hasMore ? (
          <div className="mt-4 sm:mt-5 flex justify-center">
            <button
              onClick={() => {
                void loadMore();
              }}
              disabled={isLoadingMore}
              className="px-6 py-3 rounded-lg bg-(--surface-hi) hover:bg-(--border) text-sm font-semibold disabled:opacity-70 transition-colors touch-manipulation min-h-[44px]"
            >
              {isLoadingMore ? t('transactionHistory.loading') : t('transactionHistory.loadMore')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
