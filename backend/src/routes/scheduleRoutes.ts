import { Router } from 'express';
import { z } from 'zod';
import { ScheduleController } from '../controllers/scheduleController.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { authorizeRoles, isolateOrganization } from '../middlewares/rbac.js';
import { idempotencyMiddleware } from '../middleware/idempotencyMiddleware.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { createScheduleSchema, scheduleQuerySchema } from '../schemas/scheduleSchema.js';

const router = Router();
const scheduleIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });

router.use(authenticateJWT);
router.use(isolateOrganization);

router.post(
  '/',
  authorizeRoles('EMPLOYER'),
  validateRequest({ body: createScheduleSchema }),
  idempotencyMiddleware(),
  ScheduleController.createSchedule
);

router.get(
  '/',
  authorizeRoles('EMPLOYER'),
  validateRequest({ query: scheduleQuerySchema }),
  ScheduleController.getSchedules
);

router.delete(
  '/:id',
  authorizeRoles('EMPLOYER'),
  validateRequest({ params: scheduleIdParamsSchema }),
  ScheduleController.deleteSchedule
);

export default router;
