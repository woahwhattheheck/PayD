import { Router } from 'express';
import { z } from 'zod';
import { TaxController } from '../controllers/taxController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { syncTenantFromUser } from '../middleware/tenantContext.js';
import { strictTenantBoundary, logTenantAccess } from '../middleware/enhancedTenantIsolation.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();

const taxRuleBodySchema = z.object({
  organization_id: z.number().int().positive(),
  name: z.string().min(1),
  type: z.string().min(1),
  value: z.number().nonnegative(),
  description: z.string().optional(),
  priority: z.number().int().optional(),
});
const updateTaxRuleBodySchema = taxRuleBodySchema.partial();
const taxRuleParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const taxRulesQuerySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
  includeInactive: z.enum(['true', 'false']).optional(),
});
const taxCalculationBodySchema = z.object({
  organization_id: z.number().int().positive(),
  gross_amount: z.number().nonnegative(),
  employee_id: z.number().int().positive().optional(),
  currency: z.string().min(1).max(12).optional(),
});
const taxReportQuerySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
});

router.use(authenticateJWT);
router.use(syncTenantFromUser);
router.use(strictTenantBoundary);
router.use(logTenantAccess);

router.post('/rules', validateRequest({ body: taxRuleBodySchema }), TaxController.createRule);
router.get('/rules', validateRequest({ query: taxRulesQuerySchema }), TaxController.getRules);
router.put('/rules/:id', validateRequest({ params: taxRuleParamsSchema, body: updateTaxRuleBodySchema }), TaxController.updateRule);
router.delete('/rules/:id', validateRequest({ params: taxRuleParamsSchema }), TaxController.deleteRule);
router.post('/calculate', validateRequest({ body: taxCalculationBodySchema }), TaxController.calculateDeductions);
router.get('/reports', validateRequest({ query: taxReportQuerySchema }), TaxController.getReport);

export default router;
