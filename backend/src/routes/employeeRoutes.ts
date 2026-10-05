// Modified 2026-10-05: reject non-decimal route IDs before numeric coercion.
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { employeeController } from '../controllers/employeeController.js';
import authenticateJWT from '../middlewares/auth.js';
import { authorizeRoles, isolateOrganization } from '../middlewares/rbac.js';
import { tenantQuotaService, QuotaExceededError } from '../services/tenantQuotaService.js';
import { auditSensitiveOperation } from '../middleware/auditLogger.js';
import { syncTenantFromUser } from '../middleware/tenantContext.js';
import {
  strictTenantBoundary,
  validateActiveTenant,
  logTenantAccess,
} from '../middleware/enhancedTenantIsolation.js';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  createEmployeeSchema,
  employeeQuerySchema,
  updateEmployeeSchema,
} from '../schemas/employeeSchema.js';
import { bulkImportController } from '../controllers/bulkImportController.js';

const employeeIdParamsSchema = z.object({
  id: z
    .string()
    .regex(/^[0-9]+$/, 'ID must contain only decimal digits')
    .pipe(z.coerce.number().int().positive()),
});
const createEmployeeBodySchema = createEmployeeSchema.omit({ organization_id: true });
const bulkImportBodySchema = z.object({
  organization_id: z.number().int().positive(),
  csv: z.string().min(1, 'csv is required'),
});

async function enforceEmployeeQuota(req: Request, res: Response, next: NextFunction): Promise<void> {
  const orgId = req.tenantId ?? req.user?.organizationId;
  if (!orgId) { next(); return; }
  try {
    await tenantQuotaService.assertEmployeeQuota(orgId);
    next();
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      res.status(429).json({
        error: 'Quota exceeded',
        resource: err.resource,
        current: err.current,
        limit: err.limit,
        message: `Employee quota reached (${err.current}/${err.limit}). Contact support to increase your limit.`,
      });
    } else {
      next(err);
    }
  }
}

function enhancedIsolation(): any[] {
  return [syncTenantFromUser, strictTenantBoundary, validateActiveTenant, logTenantAccess];
}

const router = Router();

router.use(authenticateJWT);
router.use(...enhancedIsolation());

router.post(
  '/',
  authorizeRoles('EMPLOYER'),
  isolateOrganization,
  validateRequest({ body: createEmployeeBodySchema }),
  enforceEmployeeQuota,
  employeeController.create.bind(employeeController)
);

router.get(
  '/',
  authorizeRoles('EMPLOYER'),
  isolateOrganization,
  validateRequest({ query: employeeQuerySchema }),
  employeeController.getAll.bind(employeeController)
);

router.get(
  '/:id',
  authorizeRoles('EMPLOYER', 'EMPLOYEE'),
  isolateOrganization,
  validateRequest({ params: employeeIdParamsSchema }),
  employeeController.getOne.bind(employeeController)
);

router.patch(
  '/:id',
  authorizeRoles('EMPLOYER'),
  isolateOrganization,
  validateRequest({ params: employeeIdParamsSchema, body: updateEmployeeSchema }),
  employeeController.update.bind(employeeController)
);

router.delete(
  '/:id',
  authorizeRoles('EMPLOYER'),
  isolateOrganization,
  validateRequest({ params: employeeIdParamsSchema }),
  auditSensitiveOperation('employee_delete'),
  employeeController.delete.bind(employeeController)
);

router.post(
  '/bulk-import',
  authorizeRoles('EMPLOYER'),
  isolateOrganization,
  validateRequest({ body: bulkImportBodySchema }),
  bulkImportController.import.bind(bulkImportController)
);

export default router;
