import axios from 'axios';
import CryptoJS from 'crypto-js';
import { randomUUID } from 'node:crypto';
import { pool } from '../config/database.js';

export interface WebhookSubscription {
  id: string;
  url: string;
  secret: string;
  events: string[];
  organizationId: number;
}

interface WebhookSubscriptionRow {
  id: string;
  url: string;
  secret: string;
  events: string[];
  organization_id: number;
}

function mapSubscription(row: WebhookSubscriptionRow): WebhookSubscription {
  return {
    id: row.id,
    url: row.url,
    secret: row.secret,
    events: row.events,
    organizationId: Number(row.organization_id),
  };
}

export class WebhookService {
  static async subscribe(
    organizationId: number,
    url: string,
    secret: string,
    events: string[]
  ): Promise<WebhookSubscription> {
    const id = randomUUID();
    const result = await pool.query<WebhookSubscriptionRow>(
      `INSERT INTO webhook_subscriptions (id, organization_id, url, secret, events)
       VALUES ($1, $2, $3, $4, $5::text[])
       RETURNING id, url, secret, events, organization_id`,
      [id, organizationId, url, secret, events]
    );

    return mapSubscription(result.rows[0]);
  }

  static async listSubscriptions(organizationId: number): Promise<WebhookSubscription[]> {
    const result = await pool.query<WebhookSubscriptionRow>(
      `SELECT id, url, secret, events, organization_id
       FROM webhook_subscriptions
       WHERE organization_id = $1
       ORDER BY created_at ASC, id ASC`,
      [organizationId]
    );

    return result.rows.map(mapSubscription);
  }

  static async deleteSubscription(id: string, organizationId: number): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM webhook_subscriptions
       WHERE id = $1 AND organization_id = $2
       RETURNING id`,
      [id, organizationId]
    );

    return result.rows.length > 0;
  }

  static async dispatch(
    organizationId: number,
    eventType: string,
    payload: any
  ): Promise<void> {
    const relevantSubscriptions = (await this.listSubscriptions(organizationId)).filter(
      (s) => s.events.includes(eventType) || s.events.includes('*')
    );

    const dispatchPromises = relevantSubscriptions.map(async (sub) => {
      const timestamp = Date.now().toString();
      const payloadString = JSON.stringify(payload);
      const signature = this.generateSignature(payloadString, sub.secret, timestamp);

      try {
        await this.sendWithRetry(sub.url, payload, {
          'X-PayD-Event': eventType,
          'X-PayD-Signature': signature,
          'X-PayD-Timestamp': timestamp,
        });
        console.log(`Webhook dispatched successfully to ${sub.url}`);
      } catch (error) {
        console.error(`Failed to dispatch webhook to ${sub.url}:`, error);
      }
    });

    await Promise.allSettled(dispatchPromises);
  }

  private static generateSignature(payload: string, secret: string, timestamp: string): string {
    const message = `${timestamp}.${payload}`;
    return CryptoJS.HmacSHA256(message, secret).toString(CryptoJS.enc.Hex);
  }

  private static async sendWithRetry(
    url: string,
    data: any,
    headers: any,
    retries = 3,
    delay = 1000
  ): Promise<void> {
    try {
      await axios.post(url, data, { headers, timeout: 5000 });
    } catch (error) {
      if (retries > 0) {
        console.log(`Retrying webhook to ${url} (${retries} attempts left)...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.sendWithRetry(url, data, headers, retries - 1, delay * 2);
      }
      throw error;
    }
  }
}
