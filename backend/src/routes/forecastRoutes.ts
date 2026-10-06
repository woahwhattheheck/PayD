import { Router } from 'express';
import { z } from 'zod';
import { ForecastController } from '../controllers/forecastController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { isolateOrganization, authorizeRoles } from '../middlewares/rbac.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();

const liquiditySettingsBodySchema = z.object({
  distributionAccount: z.string().length(56),
  assetIssuer: z.string().length(56),
  assetCode: z.string().min(1).max(12).optional(),
  benefitsRatePct: z.unknown().optional(),
  yellowBufferPct: z.unknown().optional(),
  alertEmails: z.unknown().optional(),
});

router.use(authenticateJWT);
router.use(isolateOrganization);

router.get('/', authorizeRoles('EMPLOYER'), ForecastController.getForecast);

router.get('/settings', authorizeRoles('EMPLOYER'), ForecastController.getLiquiditySettings);
router.put(
  '/settings',
  authorizeRoles('EMPLOYER'),
  validateRequest({ body: liquiditySettingsBodySchema }),
  ForecastController.updateLiquiditySettings
);

export default router;
