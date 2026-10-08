import { StellarService } from './stellarService.js';
import { pool } from '../config/database.js';

export interface AuditRecord {
  id: number;
  tx_hash: string;
  ledger_sequence: number;
  stellar_created_at: string;
  envelope_xdr: string;
  result_xdr: string;
  source_account: string;
  fee_charged: number;
  operation_count: number;
  memo: string | null;
  successful: boolean;
  created_at: string;
  employee_name?: string;
  asset?: string;
  amount?: string;
  status?: string;
  is_contract_event?: boolean;
}

export class TransactionAuditService {
  /**
   * Fetch a confirmed transaction from Horizon by hash,
   * then store it as an immutable audit record in the DB.
   * Returns the existing record if the hash was already audited.
   */
  static async fetchAndStore(txHash: string): Promise<AuditRecord> {
    // Check if already stored
    const existing = await pool.query('SELECT * FROM transaction_audit_logs WHERE tx_hash = $1', [
      txHash,
    ]);
    if (existing.rows.length > 0) return existing.rows[0];

    // Fetch from Horizon
    const server = StellarService.getServer();
    const tx = await server.transactions().transaction(txHash).call();

    const result = await pool.query(
      `INSERT INTO transaction_audit_logs
        (tx_hash, ledger_sequence, stellar_created_at, envelope_xdr,
         result_xdr, source_account, fee_charged, operation_count,
         memo, successful)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        tx.hash,
        tx.ledger_attr,
        tx.created_at,
        tx.envelope_xdr,
        tx.result_xdr,
        tx.source_account,
        parseInt(tx.fee_charged.toString(), 10),
        tx.operation_count,
        tx.memo || null,
        tx.successful,
      ]
    );

    return result.rows[0];
  }

  /**
   * Get a stored audit record by transaction hash.
   */
  static async getByHash(txHash: string): Promise<AuditRecord | null> {
    const result = await pool.query('SELECT * FROM transaction_audit_logs WHERE tx_hash = $1', [
      txHash,
    ]);
    return result.rows[0] || null;
  }

  /**
   * List audit records with pagination, optionally filtered by source account and advanced filters.
   */
  static async list(
    page: number = 1,
    limit: number = 20,
    sourceAccount?: string,
    filters?: {
      dateStart?: string | undefined;
      dateEnd?: string | undefined;
      status?: 'Completed' | 'Pending' | 'Failed' | undefined;
      employeeId?: string | undefined;
      asset?: string | undefined;
      type?: 'all' | 'transaction' | 'contract_event' | undefined;
      sort?:
        | 'created_at'
        | 'stellar_created_at'
        | 'source_account'
        | 'fee_charged'
        | 'operation_count'
        | undefined;
      order?: 'asc' | 'desc' | undefined;
    }
  ): Promise<{ data: AuditRecord[]; total: number }> {
    const offset = (page - 1) * limit;
    const sortColumns = {
      created_at: 'tal.created_at',
      stellar_created_at: 'tal.stellar_created_at',
      source_account: 'tal.source_account',
      fee_charged: 'tal.fee_charged',
      operation_count: 'tal.operation_count',
    } as const;
    const sortColumn = sortColumns[filters?.sort ?? 'created_at'];
    const sortDirection = filters?.order === 'asc' ? 'ASC' : 'DESC';
    const values: (string | number)[] = [];
    let paramIdx = 1;

    const whereClauses: string[] = [];
    // Use the same detail-row predicates for totals and paginated results.
    // Per-transaction MAX(employee_id)/MAX(asset_code) must not decide which
    // transactions match a filter (the matching detail may not be the MAX).
    const payrollWhere: string[] = [];
    if (sourceAccount) {
      whereClauses.push(`tal.source_account = $${paramIdx++}`);
      values.push(sourceAccount);
    }

    if (filters) {
      if (filters.dateStart) {
        whereClauses.push(`tal.created_at >= $${paramIdx++}`);
        values.push(filters.dateStart);
      }
      if (filters.dateEnd) {
        // Assume end of day if only date is provided
        whereClauses.push(`tal.created_at <= $${paramIdx++}::timestamp + interval '1 day'`);
        values.push(filters.dateEnd);
      }
      if (filters.status) {
        if (filters.status === 'Completed') whereClauses.push(`tal.successful = true`);
        else if (filters.status === 'Failed') whereClauses.push(`tal.successful = false`);
      }
      if (filters.employeeId) {
        payrollWhere.push(`pf.employee_id = $${paramIdx++}`);
        values.push(filters.employeeId);
      }
      if (filters.asset) {
        payrollWhere.push(`pf.asset_code = $${paramIdx++}`);
        values.push(filters.asset);
      }
    }

    if (payrollWhere.length > 0) {
      whereClauses.push(
        `EXISTS (SELECT 1 FROM payroll_audit_logs pf WHERE pf.tx_hash = tal.tx_hash AND ${payrollWhere.join(' AND ')})`
      );
    }
    const where = whereClauses.length > 0 ? `WHERE ` + whereClauses.join(' AND ') : '';
    const aggregateWhere = payrollWhere.length > 0 ? `WHERE ${payrollWhere.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM transaction_audit_logs tal
       ${where}`,
      values.slice()
    );
    const total = parseInt(countResult.rows[0].count, 10);

    values.push(limit, offset);
    const dataResult = await pool.query(
      `SELECT tal.*,
              e.first_name || ' ' || COALESCE(e.last_name, '') as employee_name,
              pal.asset_code as asset,
              pal.amount as amount,
              CASE WHEN tal.successful THEN 'Completed' ELSE 'Failed' END as status,
              false as is_contract_event
       FROM transaction_audit_logs tal
       LEFT JOIN (
           SELECT tx_hash, MAX(employee_id) as employee_id, MAX(asset_code) as asset_code, SUM(amount) as amount 
           FROM payroll_audit_logs pf ${aggregateWhere} GROUP BY tx_hash
       ) pal ON tal.tx_hash = pal.tx_hash
       LEFT JOIN employees e ON pal.employee_id = e.id
       ${where}
       ORDER BY ${sortColumn} ${sortDirection}
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      values
    );

    return { data: dataResult.rows, total };
  }

  /**
   * Re-fetch a transaction from Horizon and compare with the stored record
   * to verify integrity. Returns whether the stored XDR still matches.
   */
  static async verify(txHash: string): Promise<{ verified: boolean; record: AuditRecord | null }> {
    const record = await TransactionAuditService.getByHash(txHash);
    if (!record) return { verified: false, record: null };

    const server = StellarService.getServer();
    const tx = await server.transactions().transaction(txHash).call();

    const verified =
      record.envelope_xdr === tx.envelope_xdr &&
      record.result_xdr === tx.result_xdr &&
      record.ledger_sequence === tx.ledger_attr;

    return { verified, record };
  }
}
