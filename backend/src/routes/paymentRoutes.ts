import { Router } from 'express';
import { z } from 'zod';
import { PaymentController } from '../controllers/paymentController.js';
import { require2FA } from '../middlewares/require2fa.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { isolateOrganization } from '../middlewares/rbac.js';
import { idempotencyMiddleware } from '../middleware/idempotencyMiddleware.js';
import {
  strictTenantBoundary,
  validateActiveTenant,
  logTenantAccess,
} from '../middleware/enhancedTenantIsolation.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();

const objectPayloadSchema = z.unknown().refine(
  (value) => value !== null && typeof value === 'object',
  'payload must be an object'
);
const sep31BodySchema = z.object({
  domain: z.string().min(1),
  paymentData: objectPayloadSchema,
  secretKey: z.string().min(1),
});
const sep24BodySchema = z.object({
  domain: z.string().min(1),
  secretKey: z.string().min(1),
  withdrawalData: objectPayloadSchema,
});

router.use(authenticateJWT);
router.use(strictTenantBoundary);
router.use(validateActiveTenant);
router.use(logTenantAccess);

router.get('/anchor-info', PaymentController.getAnchorInfo);
router.post(
  '/sep31/initiate',
  isolateOrganization,
  require2FA,
  validateRequest({ body: sep31BodySchema }),
  idempotencyMiddleware(),
  PaymentController.initiateSEP31
);
router.get('/sep31/status/:domain/:id', PaymentController.getStatus);

router.get('/sep24/info', PaymentController.getSEP24Info);
router.post(
  '/sep24/withdraw',
  isolateOrganization,
  require2FA,
  validateRequest({ body: sep24BodySchema }),
  idempotencyMiddleware(),
  PaymentController.initiateSEP24Withdrawal
);
router.get('/sep24/status/:domain/:id', PaymentController.getSEP24Status);

router.get('/paths', PaymentController.getCrossAssetPaths);

export default router;
