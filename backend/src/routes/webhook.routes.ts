import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { WebhookController } from '../controllers/webhook.controller.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { syncTenantFromUser } from '../middleware/tenantContext.js';
import { strictTenantBoundary, logTenantAccess } from '../middleware/enhancedTenantIsolation.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();

const subscribeBodySchema = z.object({
  url: z.string().url(),
  secret: z.string().min(16),
  events: z.array(z.string()).optional(),
});
const triggerBodySchema = z.object({
  event: z.string().min(1).optional(),
  payload: z.unknown().optional(),
});

router.use(authenticateJWT);
router.use(syncTenantFromUser);
router.use(strictTenantBoundary);
router.use(logTenantAccess);

router.post('/subscribe', validateRequest({ body: subscribeBodySchema }), WebhookController.subscribe);
router.get('/subscriptions', WebhookController.listSubscriptions);
router.delete('/subscriptions/:id', WebhookController.deleteSubscription);

const requireNonProduction = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not Found' });
    return;
  }
  next();
};

router.post('/test-trigger', requireNonProduction, validateRequest({ body: triggerBodySchema }), WebhookController.triggerMockEvent);

export default router;
