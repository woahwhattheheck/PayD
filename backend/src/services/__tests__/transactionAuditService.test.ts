import { TransactionAuditService } from '../transactionAuditService.js';
import { Pool } from 'pg';

// Mock pg Pool
jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
  pool: {
    query: jest.fn(),
  }
}));

import { pool } from '../../config/database.js';

describe('TransactionAuditService', () => {
  const mockPool = pool as unknown as jest.Mocked<Pool>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('should call pool.query with correct base SQL when no filters are provided', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ count: '0' }] }); // Count query
      (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] }); // Data query

      await TransactionAuditService.list(1, 20);

      expect(mockPool.query).toHaveBeenCalledTimes(2);
      const countSql = (mockPool.query as jest.Mock).mock.calls[0][0];
      const dataSql = (mockPool.query as jest.Mock).mock.calls[1][0];
      expect(countSql).toContain('SELECT COUNT');
      expect(countSql).toContain('FROM transaction_audit_logs tal');
      expect(countSql).not.toContain('WHERE');
      expect(dataSql).toContain('SELECT tal.*');
      expect(dataSql).toContain('FROM transaction_audit_logs tal');
      expect(dataSql).not.toContain('WHERE');
    });

    it('should apply date filters correctly', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await TransactionAuditService.list(1, 20, undefined, {
        dateStart: '2026-01-01',
        dateEnd: '2026-01-31'
      });

      const countQuery = (mockPool.query as jest.Mock).mock.calls[0];
      const sql = countQuery[0];
      const values = countQuery[1];

      expect(sql).toContain('tal.created_at >= $');
      expect(sql).toContain('tal.created_at <= $');
      expect(values).toContain('2026-01-01');
      expect(values).toContain('2026-01-31');
    });

    it('should apply status filter correctly', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await TransactionAuditService.list(1, 20, undefined, {
        status: 'Completed'
      });

      const countQuery = (mockPool.query as jest.Mock).mock.calls[0];
      expect(countQuery[0]).toContain('tal.successful = true');
    });

    it('should apply employeeId filter correctly', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await TransactionAuditService.list(1, 20, undefined, {
        employeeId: 'emp-123'
      });

      const countQuery = (mockPool.query as jest.Mock).mock.calls[0];
      expect(countQuery[0]).toContain('pf.employee_id = $');
      expect(countQuery[1]).toContain('emp-123');
    });

    it('uses matching payroll detail predicates for totals and page rows', async () => {
      // Transactions with multiple payroll detail rows must preserve a match
      // even if the selected employee/asset is not the aggregate maximum.
      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 17, employee_name: 'Jane Doe', asset: 'USDC' }] });

      const result = await TransactionAuditService.list(1, 20, undefined, {
        employeeId: '3', asset: 'USDC',
      });
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      const [countSql, countArgs] = (mockPool.query as jest.Mock).mock.calls[0];
      const [dataSql, dataArgs] = (mockPool.query as jest.Mock).mock.calls[1];
      expect(countSql).toContain('EXISTS (SELECT 1 FROM payroll_audit_logs pf');
      expect(dataSql).toContain('EXISTS (SELECT 1 FROM payroll_audit_logs pf');
      expect(countSql).toContain('pf.employee_id = $1');
      expect(dataSql).toContain('pf.asset_code = $2');
      expect(countSql).toContain('COUNT(*) FROM transaction_audit_logs tal');
      expect(dataSql).toContain('FROM payroll_audit_logs pf WHERE pf.employee_id = $1 AND pf.asset_code = $2');
      expect(countArgs).toEqual(['3', 'USDC']);
      expect(dataSql).toContain('LIMIT $3 OFFSET $4');
      expect(dataArgs).toEqual(['3', 'USDC', 20, 0]);
    });

    it('should apply asset filter correctly', async () => {
      (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ count: '0' }] });
      (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      await TransactionAuditService.list(1, 20, undefined, {
        asset: 'USDC'
      });

      const countQuery = (mockPool.query as jest.Mock).mock.calls[0];
      expect(countQuery[0]).toContain('pf.asset_code = $');
      expect(countQuery[1]).toContain('USDC');
    });
  });
});
