import { Router } from 'express';
import { z } from 'zod';
import { TrustlineController } from '../controllers/trustlineController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { syncTenantFromUser } from '../middleware/tenantContext.js';
import { strictTenantBoundary, logTenantAccess } from '../middleware/enhancedTenantIsolation.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();

const employeeParamsSchema = z.object({
  employeeId: z.string().regex(/^[1-9][0-9]*$/, 'employeeId must be a positive integer'),
});
const issuerBodySchema = z.object({
  assetIssuer: z.string().length(56),
});
const promptBodySchema = z.object({
  employeeId: z.number().int().positive(),
  walletAddress: z.string().length(56),
  assetIssuer: z.string().length(56),
});

router.use(authenticateJWT);
router.use(syncTenantFromUser);
router.use(strictTenantBoundary);
router.use(logTenantAccess);

/**
 * @route GET /api/trustlines/check/:walletAddress?assetIssuer=G...
 * @desc Detect ORGUSD trustline status for any wallet via Horizon
 */
router.get('/check/:walletAddress', TrustlineController.checkWallet);

/**
 * @route GET /api/trustlines/employees/:employeeId
 * @desc Get stored trustline status for an employee
 */
router.get('/employees/:employeeId', TrustlineController.getEmployeeStatus);

/**
 * @route POST /api/trustlines/employees/:employeeId/refresh
 * @desc Re-check Horizon and update trustline status in DB
 * @body { assetIssuer: string }
 */
router.post(
  '/employees/:employeeId/refresh',
  validateRequest({ params: employeeParamsSchema, body: issuerBodySchema }),
  TrustlineController.refreshEmployee
);

/**
 * @route POST /api/trustlines/prompt
 * @desc Build unsigned changeTrust XDR for employee to sign
 * @body { employeeId: number, walletAddress: string, assetIssuer: string }
 */
router.post('/prompt', validateRequest({ body: promptBodySchema }), TrustlineController.promptTrustline);

export default router;
