import { Router } from 'express';
import { z } from 'zod';
import { PayrollBonusController } from '../controllers/payrollBonusController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { isolateOrganization } from '../middlewares/rbac.js';
import { idempotencyMiddleware } from '../middleware/idempotencyMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();

const positiveId = z.number().int().positive();
const routeIdParamsSchema = z.object({
  id: z.string().regex(/^[1-9][0-9]*$/, 'id must be a positive integer'),
});
const payrollRunBodySchema = z.object({
  organizationId: positiveId,
  periodStart: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'periodStart must be a valid date'),
  periodEnd: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'periodEnd must be a valid date'),
  assetCode: z.string().min(1).max(12).optional(),
});
const amountSchema = z.string().refine((value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0;
}, 'amount must be a positive number');
const bonusItemSchema = z.object({
  employeeId: positiveId,
  amount: amountSchema,
  description: z.string().optional(),
});
const bonusBodySchema = bonusItemSchema.extend({
  payrollRunId: positiveId,
});
const batchBonusBodySchema = z.object({
  payrollRunId: positiveId,
  items: z.array(bonusItemSchema).min(1),
});
const statusBodySchema = z.object({
  status: z.enum(['draft', 'pending', 'processing', 'completed', 'failed']),
});

router.use(authenticateJWT);
router.use(isolateOrganization);

router.post('/runs', validateRequest({ body: payrollRunBodySchema }), idempotencyMiddleware(), PayrollBonusController.createPayrollRun);
router.get('/runs', PayrollBonusController.listPayrollRuns);
router.get('/runs/:id', PayrollBonusController.getPayrollRun);
router.patch('/runs/:id/status', validateRequest({ params: routeIdParamsSchema, body: statusBodySchema }), PayrollBonusController.updatePayrollRunStatus);
router.post('/items/bonus', validateRequest({ body: bonusBodySchema }), idempotencyMiddleware(), PayrollBonusController.addBonusItem);
router.post(
  '/items/bonus/batch',
  validateRequest({ body: batchBonusBodySchema }),
  idempotencyMiddleware(),
  PayrollBonusController.addBatchBonusItems
);
router.get('/runs/:payrollRunId/items', PayrollBonusController.getPayrollItems);
router.delete('/items/:itemId', PayrollBonusController.deletePayrollItem);
router.get('/bonuses/history', PayrollBonusController.getBonusHistory);

export default router;
