import { Router } from 'express';
import { z } from 'zod';
import { FreezeController } from '../controllers/freezeController.js';
import { rateLimitMiddleware } from '../middlewares/rateLimitMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();
const adminRateLimit = rateLimitMiddleware({ tier: 'api' });

const baseFreezeSchema = z.object({
  issuerSecret: z.string().min(56),
  assetCode: z.string().min(1).max(12).regex(/^[A-Z0-9]+$/),
  reason: z.string().max(500).optional(),
});
const accountFreezeSchema = baseFreezeSchema.extend({
  targetAccount: z.string().length(56),
});
const targetAccountParamsSchema = z.object({ targetAccount: z.string().length(56) });
const statusQuerySchema = z.object({
  assetIssuer: z.string().length(56),
  assetCode: z.string().min(1).max(12).regex(/^[A-Z0-9]+$/),
});
const listLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  targetAccount: z.string().length(56).optional(),
  action: z.enum(['freeze', 'unfreeze']).optional(),
  assetCode: z.string().max(12).regex(/^[A-Z0-9]+$/).optional(),
});

router.post('/account/freeze', adminRateLimit, validateRequest({ body: accountFreezeSchema }), FreezeController.freezeAccount);
router.post('/account/unfreeze', adminRateLimit, validateRequest({ body: accountFreezeSchema }), FreezeController.unfreezeAccount);
router.post('/global/freeze', adminRateLimit, validateRequest({ body: baseFreezeSchema }), FreezeController.freezeGlobal);
router.post('/global/unfreeze', adminRateLimit, validateRequest({ body: baseFreezeSchema }), FreezeController.unfreezeGlobal);
router.get('/status/:targetAccount', validateRequest({ params: targetAccountParamsSchema, query: statusQuerySchema }), FreezeController.checkStatus);
router.get('/logs', validateRequest({ query: listLogsQuerySchema }), FreezeController.getLogs);

export default router;
