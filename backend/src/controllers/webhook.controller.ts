import { Request, Response } from 'express';
import { WebhookService } from '../services/webhook.service.js';
import { z } from 'zod';

const subscribeSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(16),
  events: z.array(z.string()).min(1).default(['*']),
});

const updateSubscriptionSchema = z
  .object({
    url: z.string().url().optional(),
    secret: z.string().min(16).optional(),
    events: z.array(z.string()).min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one subscription field must be provided',
  });

export class WebhookController {
  static async subscribe(req: Request, res: Response) {
    try {
      const validatedData = subscribeSchema.parse(req.body);
      const organizationId = req.tenantId!;
      const subscription = await WebhookService.subscribe(
        organizationId,
        validatedData.url,
        validatedData.secret,
        validatedData.events
      );
      res.status(201).json(subscription);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues });
        return;
      }
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  static async listSubscriptions(req: Request, res: Response) {
    try {
      const organizationId = req.tenantId!;
      const subscriptions = await WebhookService.listSubscriptions(organizationId);
      res.json(subscriptions);
    } catch {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  static async updateSubscription(req: Request, res: Response) {
    try {
      const validatedData = updateSubscriptionSchema.parse(req.body);
      const organizationId = req.tenantId!;
      const subscription = await WebhookService.updateSubscription(
        req.params.id as string,
        organizationId,
        validatedData
      );

      if (!subscription) {
        res.status(404).json({ error: 'Subscription not found' });
        return;
      }

      res.json(subscription);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: error.issues });
        return;
      }
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  static async deleteSubscription(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const organizationId = req.tenantId!;
      const success = await WebhookService.deleteSubscription(id as string, organizationId);
      if (success) {
        res.status(204).send();
        return;
      }
      res.status(404).json({ error: 'Subscription not found' });
    } catch {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  static async triggerMockEvent(req: Request, res: Response) {
    const { event, payload } = req.body;
    await WebhookService.dispatch(
      (event as string) || 'payment.completed',
      payload || { id: 'test_tx_123', amount: 100 },
      req.tenantId!
    );
    res.json({ message: 'Mock event dispatched' });
  }
}
