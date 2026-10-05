import { Router } from 'express';
import { z } from 'zod';
import { AssetController } from '../controllers/assetController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { authorizeRoles } from '../middlewares/rbac.js';
import { syncTenantFromUser } from '../middleware/tenantContext.js';
import {
  strictTenantBoundary,
  validateActiveTenant,
  logTenantAccess,
} from '../middleware/enhancedTenantIsolation.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();

const amountSchema = z.union([z.number().positive(), z.string().min(1)]);
const issueAssetBodySchema = z.object({
  issuerSecret: z.string().min(1),
  distributorSecret: z.string().min(1),
  amount: amountSchema,
});
const clawbackBodySchema = z.object({
  issuerSecret: z.string().min(1),
  fromAccount: z.string().min(1),
  amount: amountSchema,
  reason: z.string().max(500).optional(),
});
const clawbackLogsQuerySchema = z.object({
  fromAccount: z.string().min(1).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

router.use(authenticateJWT);
router.use(syncTenantFromUser);
router.use(strictTenantBoundary);
router.use(validateActiveTenant);
router.use(logTenantAccess);
router.use(authorizeRoles('EMPLOYER'));

router.post('/issue', validateRequest({ body: issueAssetBodySchema }), AssetController.issueOrgUsd);
router.post('/clawback', validateRequest({ body: clawbackBodySchema }), AssetController.clawback);
router.get('/clawback/logs', validateRequest({ query: clawbackLogsQuerySchema }), AssetController.getClawbackLogs);

export default router;
