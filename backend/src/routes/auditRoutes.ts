// Modified 2026-10-05: validate audit requests before controller dispatch.
import { Router } from 'express';
import { z } from 'zod';
import { TransactionAuditController } from '../controllers/transactionAuditController.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();

// Preserve the controller's supported filters, defaults and pagination limits.
// The shared middleware validates without replacing the original request values.
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sourceAccount: z.string().length(56).optional(),
  dateStart: z.string().optional(),
  dateEnd: z.string().optional(),
  status: z.enum(['Completed', 'Pending', 'Failed']).optional(),
  employeeId: z.string().optional(),
  asset: z.string().optional(),
  type: z.enum(['all', 'transaction', 'contract_event']).default('all'),
});
const transactionParamsSchema = z.object({
  txHash: z.string().regex(/^[a-fA-F0-9]{64}$/, 'Transaction hash must contain 64 hexadecimal characters'),
});
const validateTransaction = validateRequest({ params: transactionParamsSchema });

/**
 * @route GET /api/audit
 * @desc List audit records with pagination
 * @query page, limit, sourceAccount
 */
router.get('/', validateRequest({ query: listQuerySchema }), TransactionAuditController.listAuditRecords);

/**
 * @route GET /api/audit/:txHash
 * @desc Get a stored audit record by transaction hash
 */
router.get('/:txHash', validateTransaction, TransactionAuditController.getAuditRecord);

/**
 * @route GET /api/audit/:txHash/verify
 * @desc Re-fetch from Horizon and verify integrity of stored record
 */
router.get('/:txHash/verify', validateTransaction, TransactionAuditController.verifyAuditRecord);

/**
 * @route POST /api/audit/:txHash
 * @desc Fetch transaction from Horizon and create immutable audit record
 */
router.post('/:txHash', validateTransaction, TransactionAuditController.createAuditRecord);

export default router;
