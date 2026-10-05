import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { BenefitsController } from '../controllers/benefitsController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { authorizeRoles, isolateOrganization } from '../middlewares/rbac.js';
import { setTenantContext } from '../middleware/tenantContext.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  benefitPlanSchema,
  updateBenefitPlanSchema,
  employeeBenefitEnrollmentSchema,
  deductionRuleSchema,
  updateDeductionRuleSchema,
  draftPayslipSchema,
} from '../schemas/benefitsSchema.js';

const router = Router();

const organizationParamsSchema = z.object({
  organizationId: z.coerce.number().int().positive(),
}).passthrough();
const resourceParamsSchema = organizationParamsSchema.extend({
  id: z.coerce.number().int().positive(),
});
const employeeParamsSchema = organizationParamsSchema.extend({
  employeeId: z.coerce.number().int().positive(),
});
const includeInactiveQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).optional(),
});
const benefitPlanBodySchema = benefitPlanSchema.omit({ organization_id: true });
const enrollmentBodySchema = employeeBenefitEnrollmentSchema.omit({ organization_id: true });
const deductionRuleBodySchema = deductionRuleSchema.omit({ organization_id: true });
const draftPayslipBodySchema = draftPayslipSchema.omit({ organization_id: true });

router.use(authenticateJWT);
router.use(isolateOrganization);

const setTenantFromJwt = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.organizationId) {
    return res.status(400).json({ error: 'Missing organizationId in token' });
  }
  (req as any).tenantId = req.user.organizationId;
  return next();
};

// Benefit Plans
router.post(
  '/organizations/:organizationId/plans',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  validateRequest({ params: organizationParamsSchema, body: benefitPlanBodySchema }),
  BenefitsController.createBenefitPlan
);

router.get(
  '/organizations/:organizationId/plans',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  validateRequest({ params: organizationParamsSchema, query: includeInactiveQuerySchema }),
  BenefitsController.listBenefitPlans
);

router.put(
  '/organizations/:organizationId/plans/:id',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  validateRequest({ params: resourceParamsSchema, body: updateBenefitPlanSchema }),
  BenefitsController.updateBenefitPlan
);

router.delete(
  '/organizations/:organizationId/plans/:id',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  validateRequest({ params: resourceParamsSchema }),
  BenefitsController.deleteBenefitPlan
);

// Employee benefit enrollments
router.post(
  '/organizations/:organizationId/enrollments',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  validateRequest({ params: organizationParamsSchema, body: enrollmentBodySchema }),
  BenefitsController.upsertEmployeeEnrollment
);

router.get(
  '/organizations/:organizationId/employees/:employeeId/enrollments',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  validateRequest({ params: employeeParamsSchema }),
  BenefitsController.listEmployeeEnrollments
);

// Deduction rules
router.post(
  '/organizations/:organizationId/deduction-rules',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  validateRequest({ params: organizationParamsSchema, body: deductionRuleBodySchema }),
  BenefitsController.createDeductionRule
);

router.get(
  '/organizations/:organizationId/deduction-rules',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  validateRequest({ params: organizationParamsSchema, query: includeInactiveQuerySchema }),
  BenefitsController.listDeductionRules
);

router.put(
  '/organizations/:organizationId/deduction-rules/:id',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  validateRequest({ params: resourceParamsSchema, body: updateDeductionRuleSchema }),
  BenefitsController.updateDeductionRule
);

router.delete(
  '/organizations/:organizationId/deduction-rules/:id',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  validateRequest({ params: resourceParamsSchema }),
  BenefitsController.deleteDeductionRule
);

// Draft payslip (gross vs net)
router.post(
  '/organizations/:organizationId/draft-payslips',
  authorizeRoles('EMPLOYER'),
  setTenantFromJwt,
  setTenantContext,
  validateRequest({ params: organizationParamsSchema, body: draftPayslipBodySchema }),
  BenefitsController.generateDraftPayslip
);

// Employee view: deductions breakdown for the authenticated wallet
router.get('/me/deductions', authorizeRoles('EMPLOYEE'), setTenantFromJwt, setTenantContext, BenefitsController.getMyDeductions);

export default router;
