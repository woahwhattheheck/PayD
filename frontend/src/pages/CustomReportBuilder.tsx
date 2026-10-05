import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Icon } from '@stellar/design-system';

// Define all possible columns for the report
type ReportColumn = {
  id: string;
  labelKey: string;
};

const ALL_COLUMNS: ReportColumn[] = [
  { id: 'worker_id', labelKey: 'customReportBuilder.columns.workerId' },
  { id: 'amount', labelKey: 'customReportBuilder.columns.amount' },
  { id: 'asset', labelKey: 'customReportBuilder.columns.asset' },
  { id: 'setup_date', labelKey: 'customReportBuilder.columns.setupDate' },
  { id: 'payout_date', labelKey: 'customReportBuilder.columns.payoutDate' },
  { id: 'status', labelKey: 'customReportBuilder.columns.status' },
];

// Mock data (matching the columns)
const MOCK_DATA = [
  {
    worker_id: 'W-1001',
    amount: '500.00',
    asset: 'USDC',
    setup_date: '2026-02-01',
    payout_date: '2026-02-15',
    status: 'Paid',
  },
  {
    worker_id: 'W-1002',
    amount: '750.00',
    asset: 'USDC',
    setup_date: '2026-02-01',
    payout_date: '2026-02-15',
    status: 'Paid',
  },
  {
    worker_id: 'W-1003',
    amount: '1200.00',
    asset: 'XLM',
    setup_date: '2026-02-05',
    payout_date: '2026-02-28',
    status: 'Pending',
  },
  {
    worker_id: 'W-1004',
    amount: '400.00',
    asset: 'USDC',
    setup_date: '2026-02-10',
    payout_date: '2026-02-28',
    status: 'Pending',
  },
  {
    worker_id: 'W-1005',
    amount: '3000.00',
    asset: 'XLM',
    setup_date: '2026-01-15',
    payout_date: '2026-01-31',
    status: 'Paid',
  },
];

const CustomReportBuilder = () => {
  const { t } = useTranslation();
  const [selectedColumns, setSelectedColumns] = useState<string[]>(ALL_COLUMNS.map((c) => c.id));
  const [startDate, setStartDate] = useState<string>('2026-02-01');
  const [endDate, setEndDate] = useState<string>('2026-02-28');

  const toggleColumn = (colId: string) => {
    setSelectedColumns((prev) =>
      prev.includes(colId) ? prev.filter((id) => id !== colId) : [...prev, colId]
    );
  };

  const activeColumns = ALL_COLUMNS.filter((c) => selectedColumns.includes(c.id));

  // Filter data by date range
  const filteredData = useMemo(() => {
    return MOCK_DATA.filter((row) => {
      const rowDate = new Date(row.setup_date);
      const start = startDate ? new Date(startDate) : new Date('2000-01-01');
      const end = endDate ? new Date(endDate) : new Date('2100-01-01');
      return rowDate >= start && rowDate <= end;
    });
  }, [startDate, endDate]);

  const handleExport = () => {
    // Simulate export logic (e.g. converting filteredData to CSV and triggering download)
    alert(
      t('customReportBuilder.exporting', { count: filteredData.length, columns: activeColumns.map((c) => t(c.labelKey)).join(', ') })
    );
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-(--text) mb-2">{t('customReportBuilder.title')}</h1>
        <p className="text-(--muted)">{t('customReportBuilder.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        {/* Controls Sidebar */}
        <div className="md:col-span-1 space-y-6 flex flex-col">
          <Card>
            <div className="p-4 space-y-4">
              <h3 className="font-semibold text-lg border-b pb-2">{t('customReportBuilder.dateRange')}</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-(--text) mb-1">{t('customReportBuilder.startDate')}</label>
                  <input
                    type="date"
                    className="w-full border-(--border-hi) rounded-md shadow-sm p-2 bg-white text-(--text)"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-(--text) mb-1">{t('customReportBuilder.endDate')}</label>
                  <input
                    type="date"
                    className="w-full border-(--border-hi) rounded-md shadow-sm p-2 bg-white text-(--text)"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-4 space-y-4">
              <h3 className="font-semibold text-lg border-b pb-2">{t('customReportBuilder.columnsTitle')}</h3>
              <div className="space-y-2">
                {ALL_COLUMNS.map((col) => (
                  <label key={col.id} className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="form-checkbox h-4 w-4 text-blue-600 rounded border-(--border-hi)"
                      checked={selectedColumns.includes(col.id)}
                      onChange={() => toggleColumn(col.id)}
                    />
                    <span className="text-(--text) text-sm">{t(col.labelKey)}</span>
                  </label>
                ))}
              </div>
            </div>
          </Card>

          <Button
            onClick={handleExport}
            variant="primary"
            size="md"
            className="w-full flex justify-center mt-auto"
          >
            <Icon.DownloadCloud01 className="mr-2" />{t('customReportBuilder.exportData')}</Button>
        </div>

        {/* Live Preview Pane */}
        <div className="md:col-span-3">
          <Card>
            <div className="p-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-xl">{t('customReportBuilder.livePreview')}</h3>
                <span className="text-sm text-(--muted) bg-(--surface-hi) px-3 py-1 rounded-full">
                  {t('customReportBuilder.recordsFound', { count: filteredData.length })}
                </span>
              </div>

              <div className="overflow-x-auto">
                {activeColumns.length > 0 ? (
                  <table className="min-w-full divide-y divide-(--border)">
                    <thead className="bg-(--surface-hi)">
                      <tr>
                        {activeColumns.map((col) => (
                          <th
                            key={col.id}
                            className="px-6 py-3 text-left text-xs font-medium text-(--muted) uppercase tracking-wider"
                          >
                            {t(col.labelKey)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-(--border)">
                      {filteredData.map((row) => (
                        <tr key={row.worker_id} className="hover:bg-(--surface-hi)">
                          {activeColumns.map((col) => (
                            <td
                              key={col.id}
                              className="px-6 py-4 whitespace-nowrap text-sm text-(--text)"
                            >
                              {col.id === 'status'
                                ? t(`customReportBuilder.status.${String(row[col.id as keyof typeof row]).toLowerCase()}`)
                                : row[col.id as keyof typeof row]}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {filteredData.length === 0 && (
                        <tr>
                          <td
                            colSpan={activeColumns.length}
                            className="px-6 py-8 text-center text-(--muted)"
                          >{t('customReportBuilder.noData')}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                ) : (
                  <div className="py-12 text-center text-(--muted) border-2 border-dashed border-(--border-hi) rounded-lg">{t('customReportBuilder.selectColumn')}</div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default CustomReportBuilder;
