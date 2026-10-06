import { Router } from 'express';
import { z } from 'zod';
import { BalanceController } from '../controllers/balanceController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { syncTenantFromUser } from '../middleware/tenantContext.js';
import { strictTenantBoundary, logTenantAccess } from '../middleware/enhancedTenantIsolation.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();

const preflightBodySchema = z.object({
  distributionAccount: z.string().length(56),
  assetIssuer: z.string().length(56),
  payments: z.array(z.object({
    employeeId: z.string().min(1),
    employeeName: z.string().min(1),
    walletAddress: z.string().length(56),
    amount: z.string().min(1),
  })).min(1),
});

router.use(authenticateJWT);
router.use(syncTenantFromUser);
router.use(strictTenantBoundary);
router.use(logTenantAccess);

/**
 * @route GET /api/balance/:accountId
 * @desc Query ORGUSD balance for a Stellar account
 * @query assetIssuer - The ORGUSD issuer public key
 */
router.get('/:accountId', BalanceController.checkBalance);

/**
 * @route POST /api/balance/preflight
 * @desc Run preflight balance check before payroll execution.
 *       Aborts with a shortfall report if ORGUSD balance
 *       is insufficient to cover all scheduled payments.
 * @body { distributionAccount, assetIssuer, payments[] }
 */
router.post('/preflight', validateRequest({ body: preflightBodySchema }), BalanceController.preflightPayroll);

export default router;
