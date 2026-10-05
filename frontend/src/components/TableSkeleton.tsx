import './TableSkeleton.css';

interface TableSkeletonProps {
  /** Number of rows expected by the containing view or page size. */
  rows?: number;
  columns: number;
  label?: string;
  /** Match the real cells, including responsive padding. */
  cellClassName?: string;
  rowHeight?: number;
}

/** Placeholder rows for an existing tbody. Headers and column layout stay mounted. */
export function TableSkeleton({
  rows = 5,
  columns,
  label = 'Loading table data',
  cellClassName = 'p-3',
  rowHeight = 48,
}: TableSkeletonProps) {
  const rowCount = Number.isFinite(rows) ? Math.min(100, Math.max(0, Math.floor(rows))) : 5;
  const columnCount = Number.isFinite(columns) ? Math.min(30, Math.max(1, Math.floor(columns))) : 1;
  const rowKeys = Array.from({ length: rowCount }, (_, index) => `skeleton-row-${index}`);
  const columnKeys = Array.from({ length: columnCount }, (_, index) => `skeleton-cell-${index}`);

  return (
    <>
      <tr className="sr-only">
        <td colSpan={columnCount}>
          <span role="status">{label}</span>
        </td>
      </tr>
      {rowKeys.map((rowKey) => (
        <tr key={rowKey} data-skeleton-row="" aria-hidden="true" style={{ height: rowHeight }}>
          {columnKeys.map((columnKey) => (
            <td key={columnKey} className={cellClassName}>
              <span className="payd-table-placeholder" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
