import axios from 'axios';
import CryptoJS from 'crypto-js';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database.js';

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

interface WebhookSubscriptionUpdates {
  url?: string;
  secret?: string;
  events?: string[];
}

function toSubscription(row: WebhookSubscriptionRow): WebhookSubscription {
  return {
    id: row.id,
    url: row.url,
    secret: row.secret,
    events: row.events,
    organizationId: row.organization_id,
  };
}

export class WebhookService {
  static async subscribe(
    organizationId: number,
    url: string,
    secret: string,
    events: string[]
  ): Promise<WebhookSubscription> {
    const id = uuidv4();
    const result = await pool.query<WebhookSubscriptionRow>(
      `INSERT INTO webhook_subscriptions (id, organization_id, url, secret, events)
       VALUES ($1, $2, $3, $4, $5::text[])
       RETURNING id, url, secret, events, organization_id`,
      [id, organizationId, url, secret, events]
    );

    return toSubscription(result.rows[0]);
  }

  static async listSubscriptions(organizationId: number): Promise<WebhookSubscription[]> {
    const result = await pool.query<WebhookSubscriptionRow>(
      `SELECT id, url, secret, events, organization_id
       FROM webhook_subscriptions
       WHERE organization_id = $1
       ORDER BY created_at ASC`,
      [organizationId]
    );

    return result.rows.map(toSubscription);
  }

  static async updateSubscription(
    id: string,
    organizationId: number,
    updates: WebhookSubscriptionUpdates
  ): Promise<WebhookSubscription | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];

    if (updates.url !== undefined) {
      values.push(updates.url);
      assignments.push(`url = $${values.length}`);
    }
    if (updates.secret !== undefined) {
      values.push(updates.secret);
      assignments.push(`secret = $${values.length}`);
    }
    if (updates.events !== undefined) {
      values.push(updates.events);
      assignments.push(`events = $${values.length}::text[]`);
    }

    if (assignments.length === 0) {
      return null;
    }

    values.push(id, organizationId);
    const idParameter = values.length - 1;
    const organizationParameter = values.length;

    const result = await pool.query<WebhookSubscriptionRow>(
      `UPDATE webhook_subscriptions
       SET ${assignments.join(', ')}
       WHERE id = $${idParameter} AND organization_id = $${organizationParameter}
       RETURNING id, url, secret, events, organization_id`,
      values
    );

    return result.rows[0] ? toSubscription(result.rows[0]) : null;
  }

  static async deleteSubscription(id: string, organizationId: number): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM webhook_subscriptions
       WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  static async dispatch(eventType: string, payload: any, organizationId: number): Promise<void> {
    // A subscription belonging to another employer must never receive this
    // organization's financial or payment events, including wildcard events.
    if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
      throw new Error('Verified organization scope required for webhook delivery');
    }
    const result = await pool.query<WebhookSubscriptionRow>(
      `SELECT id, url, secret, events, organization_id
       FROM webhook_subscriptions
       WHERE organization_id = $2
         AND (events @> ARRAY[$1]::text[]
           OR events @> ARRAY['*']::text[])`,
      [eventType, organizationId]
    );
    const relevantSubscriptions = result.rows.map(toSubscription);

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
