import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import webhookRoutes from '../webhook.routes.js';
import { pool } from '../../config/database.js';

const JWT_SECRET = 'test-secret';

jest.mock('../../config/env.js', () => ({
  config: { JWT_SECRET: 'test-secret' },
}));

jest.mock('../../config/database.js', () => {
  const query = jest.fn();
  const client = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  };
  const pool = {
    query,
    connect: jest.fn().mockResolvedValue(client),
  };

  return {
    __esModule: true,
    default: pool,
    pool,
  };
});

jest.mock('../../utils/logger.js', () => ({
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

interface StoredSubscription {
  id: string;
  organization_id: number;
  url: string;
  secret: string;
  events: string[];
  created_at: Date;
}

let storedSubscriptions: StoredSubscription[] = [];

function makeToken(payload: object): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

const tenantAToken = makeToken({
  id: 1,
  organizationId: 10,
  email: 'admin@orgA.com',
  role: 'EMPLOYER',
});

const tenantBToken = makeToken({
  id: 2,
  organizationId: 20,
  email: 'admin@orgB.com',
  role: 'EMPLOYER',
});

const app = express();
app.use(express.json());
app.use('/webhooks', webhookRoutes);

describe('Webhook Routes - Auth and Tenant Isolation', () => {
  beforeEach(() => {
    storedSubscriptions = [];
    jest.clearAllMocks();

    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.startsWith('INSERT INTO webhook_subscriptions')) {
        const row: StoredSubscription = {
          id: params[0],
          organization_id: params[1],
          url: params[2],
          secret: params[3],
          events: params[4],
          created_at: new Date(),
        };
        storedSubscriptions.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (
        normalized.startsWith('SELECT id, url, secret, events, organization_id') &&
        normalized.includes('WHERE organization_id = $1')
      ) {
        return {
          rows: storedSubscriptions.filter((row) => row.organization_id === params[0]),
          rowCount: 0,
        };
      }

      if (normalized.startsWith('UPDATE webhook_subscriptions')) {
        const organizationId = params[params.length - 1];
        const id = params[params.length - 2];
        const row = storedSubscriptions.find(
          (candidate) => candidate.id === id && candidate.organization_id === organizationId
        );

        if (!row) return { rows: [], rowCount: 0 };

        let valueIndex = 0;
        if (normalized.includes('url = $')) row.url = params[valueIndex++];
        if (normalized.includes('secret = $')) row.secret = params[valueIndex++];
        if (normalized.includes('events = $')) row.events = params[valueIndex++];

        return { rows: [row], rowCount: 1 };
      }

      if (normalized.startsWith('DELETE FROM webhook_subscriptions')) {
        const [id, organizationId] = params;
        const before = storedSubscriptions.length;
        storedSubscriptions = storedSubscriptions.filter(
          (row) => !(row.id === id && row.organization_id === organizationId)
        );
        return { rows: [], rowCount: before - storedSubscriptions.length };
      }

      if (
        normalized.startsWith('SELECT id, url, secret, events, organization_id') &&
        normalized.includes('WHERE organization_id = $2')
      ) {
        return {
          rows: storedSubscriptions.filter(
            (row) => row.organization_id === params[1] &&
              (row.events.includes(params[0]) || row.events.includes('*'))
          ),
          rowCount: 0,
        };
      }

      // Tenant access logging and unrelated middleware queries are not under test here.
      return { rows: [], rowCount: 0 };
    });
  });

  describe('Authentication required', () => {
    it('rejects POST /subscribe with no token', async () => {
      const res = await request(app)
        .post('/webhooks/subscribe')
        .send({ url: 'https://example.com/hook', secret: 'a'.repeat(16), events: ['*'] });

      expect(res.status).toBe(401);
    });

    it('rejects GET /subscriptions with no token', async () => {
      const res = await request(app).get('/webhooks/subscriptions');
      expect(res.status).toBe(401);
    });

    it('rejects DELETE /subscriptions/:id with no token', async () => {
      const res = await request(app).delete('/webhooks/subscriptions/fake-id');
      expect(res.status).toBe(401);
    });

    it('rejects POST /test-trigger with no token', async () => {
      const res = await request(app)
        .post('/webhooks/test-trigger')
        .send({ event: 'payment.completed' });

      expect(res.status).toBe(401);
    });

    it('rejects requests with an invalid token', async () => {
      const res = await request(app)
        .get('/webhooks/subscriptions')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(403);
    });
  });

  describe('Tenant isolation and CRUD', () => {
    it('scopes subscriptions to the creating tenant', async () => {
      const resA = await request(app)
        .post('/webhooks/subscribe')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ url: 'https://orgA.example.com/hook', secret: 'a'.repeat(16), events: ['*'] });

      expect(resA.status).toBe(201);
      expect(resA.body.organizationId).toBe(10);
      expect(resA.body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );

      const listA = await request(app)
        .get('/webhooks/subscriptions')
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(listA.status).toBe(200);
      expect(listA.body).toHaveLength(1);
      expect(listA.body[0].organizationId).toBe(10);
    });

    it('reads subscriptions written by another backend instance from shared storage', async () => {
      storedSubscriptions.push({
        id: '00000000-0000-4000-8000-000000000001',
        organization_id: 10,
        url: 'https://other-pod.example.com/hook',
        secret: 's'.repeat(16),
        events: ['payment.completed'],
        created_at: new Date('2026-10-08T00:00:00Z'),
      });

      const listA = await request(app)
        .get('/webhooks/subscriptions')
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(listA.status).toBe(200);
      expect(listA.body).toHaveLength(1);
      expect(listA.body[0].id).toBe('00000000-0000-4000-8000-000000000001');
      expect(listA.body[0].url).toBe('https://other-pod.example.com/hook');
    });

    it('tenant B cannot see tenant A subscriptions', async () => {
      await request(app)
        .post('/webhooks/subscribe')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ url: 'https://orgA.example.com/hook', secret: 'a'.repeat(16), events: ['*'] });

      const listB = await request(app)
        .get('/webhooks/subscriptions')
        .set('Authorization', `Bearer ${tenantBToken}`);

      expect(listB.status).toBe(200);
      expect(listB.body).toHaveLength(0);
    });

    it('tenant can update their own subscription', async () => {
      const createRes = await request(app)
        .post('/webhooks/subscribe')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({
          url: 'https://orgA.example.com/hook',
          secret: 'a'.repeat(16),
          events: ['payment.completed'],
        });

      const updateRes = await request(app)
        .patch(`/webhooks/subscriptions/${createRes.body.id}`)
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({
          url: 'https://orgA.example.com/replacement',
          events: ['payment.failed'],
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.url).toBe('https://orgA.example.com/replacement');
      expect(updateRes.body.events).toEqual(['payment.failed']);
      expect(updateRes.body.organizationId).toBe(10);
    });

    it('tenant B cannot update tenant A subscription by ID', async () => {
      const createRes = await request(app)
        .post('/webhooks/subscribe')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ url: 'https://orgA.example.com/hook', secret: 'a'.repeat(16), events: ['*'] });

      const updateRes = await request(app)
        .patch(`/webhooks/subscriptions/${createRes.body.id}`)
        .set('Authorization', `Bearer ${tenantBToken}`)
        .send({ url: 'https://orgB.example.com/steal' });

      expect(updateRes.status).toBe(404);
    });

    it('tenant B cannot delete tenant A subscription by ID', async () => {
      const createRes = await request(app)
        .post('/webhooks/subscribe')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ url: 'https://orgA.example.com/hook', secret: 'a'.repeat(16), events: ['*'] });

      const subId = createRes.body.id;

      const deleteRes = await request(app)
        .delete(`/webhooks/subscriptions/${subId}`)
        .set('Authorization', `Bearer ${tenantBToken}`);

      expect(deleteRes.status).toBe(404);

      const listA = await request(app)
        .get('/webhooks/subscriptions')
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(listA.body).toHaveLength(1);
    });

    it('tenant can delete their own subscription', async () => {
      const createRes = await request(app)
        .post('/webhooks/subscribe')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ url: 'https://orgA.example.com/hook', secret: 'a'.repeat(16), events: ['*'] });

      const subId = createRes.body.id;

      const deleteRes = await request(app)
        .delete(`/webhooks/subscriptions/${subId}`)
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(deleteRes.status).toBe(204);

      const listA = await request(app)
        .get('/webhooks/subscriptions')
        .set('Authorization', `Bearer ${tenantAToken}`);

      expect(listA.body).toHaveLength(0);
    });
  });

  describe('test-trigger production guard', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('allows test-trigger in development', async () => {
      process.env.NODE_ENV = 'development';

      const res = await request(app)
        .post('/webhooks/test-trigger')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ event: 'payment.completed', payload: { id: 'test' } });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Mock event dispatched');
    });

    it('never selects another organization wildcard subscription for a tenant event', async () => {
      process.env.NODE_ENV = 'development';

      const created = await request(app)
        .post('/webhooks/subscribe')
        .set('Authorization', `Bearer ${tenantBToken}`)
        .send({ url: 'https://orgB.example.com/hook', secret: 'b'.repeat(16), events: ['*'] });
      expect(created.status).toBe(201);

      const triggered = await request(app)
        .post('/webhooks/test-trigger')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ event: 'payment.completed', payload: { id: 'private-tenant-A' } });
      expect(triggered.status).toBe(200);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE organization_id = $2'),
        ['payment.completed', 10]
      );
    });

    it('blocks test-trigger in production', async () => {
      process.env.NODE_ENV = 'production';

      const res = await request(app)
        .post('/webhooks/test-trigger')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ event: 'payment.completed' });

      expect(res.status).toBe(404);
    });
  });
});
