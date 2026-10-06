import { Router } from 'express';
import { z } from 'zod';
import { ThrottlingController } from '../controllers/throttlingController.js';
import { validateRequest } from '../middleware/validateRequest.js';

const router = Router();

const configBodySchema = z.object({
  tpm: z.number().positive().optional(),
  maxQueueSize: z.number().positive().optional(),
  refillIntervalMs: z.number().positive().optional(),
}).refine(
  body => Object.values(body).some(value => value !== undefined),
  { message: 'At least one configuration field is required' },
);

router.get('/status', ThrottlingController.getStatus);
router.get('/config', ThrottlingController.getConfig);
router.put('/config', validateRequest({ body: configBodySchema }), ThrottlingController.updateConfig);
router.delete('/queue', ThrottlingController.clearQueue);
router.get('/metrics', ThrottlingController.getMetrics);

export default router;
