import { default as pool } from '../config/database.js';
import type { SorobanEvent, GetEventsResponse } from '../types/contractEvent.js';
import { PoolClient } from 'pg';
import * as StellarSdk from '@stellar/stellar-sdk';

export class ContractEventIndexer {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 10000; // Poll every 10 seconds
  private readonly BATCH_SIZE = 100;
  private readonly CONTRACTS_TO_INDEX = [
    process.env.BULK_PAYMENT_CONTRACT_ID,
    process.env.VESTING_ESCROW_CONTRACT_ID,
    process.env.REVENUE_SPLIT_CONTRACT_ID,
  ].filter(Boolean) as string[];

  private readonly RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';

  /**
   * Initialize the indexer and start polling
   */
  async initialize(): Promise<void> {
    if (this.isRunning) {
      console.log('[ContractEventIndexer] Already running');
      return;
    }

    if (this.CONTRACTS_TO_INDEX.length === 0) {
      console.warn('[ContractEventIndexer] No contracts configured for indexing');
      return;
    }

    console.log('[ContractEventIndexer] Initializing...');
    console.log(`[ContractEventIndexer] Monitoring contracts: ${this.CONTRACTS_TO_INDEX.join(', ')}`);
    
    this.isRunning = true;
    
    // Run immediately on startup
    await this.pollAndIndexEvents();
    
    // Then poll at regular intervals
    this.intervalId = setInterval(async () => {
      await this.pollAndIndexEvents();
    }, this.POLL_INTERVAL_MS);

    console.log(`[ContractEventIndexer] Started polling every ${this.POLL_INTERVAL_MS}ms`);
  }

  /**
   * Stop the indexer gracefully
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[ContractEventIndexer] Stopped');
  }

  /**
   * Main polling loop - fetches and indexes new events
   */
  private async pollAndIndexEvents(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const lastIndexedLedger = await this.getLastIndexedLedger();
      console.log(`[ContractEventIndexer] Last indexed ledger: ${lastIndexedLedger}`);

      for (const contractId of this.CONTRACTS_TO_INDEX) {
        try {
          await this.indexContractEvents(contractId, lastIndexedLedger);
        } catch (error) {
          console.error(`[ContractEventIndexer] Error indexing contract ${contractId}:`, error);
          await this.updateIndexerState(lastIndexedLedger, 'error', String(error));
        }
      }
    } catch (error) {
      console.error('[ContractEventIndexer] Error in polling loop:', error);
    }
  }

  /**
   * Fetch and index events for a specific contract
   */
  private async indexContractEvents(contractId: string, fromLedger: number): Promise<void> {
    const events = await this.fetchEventsFromRPC(contractId, fromLedger);
    
    if (events.length === 0) {
      console.log(`[ContractEventIndexer] No new events for contract ${contractId}`);
      return;
    }

    console.log(`[ContractEventIndexer] Found ${events.length} new events for contract ${contractId}`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let insertedCount = 0;
      let skippedCount = 0;
      let maxLedger = fromLedger;

      for (const event of events) {
        const inserted = await this.insertEvent(client, event);
        if (inserted) {
          insertedCount++;
        } else {
          skippedCount++;
        }
        maxLedger = Math.max(maxLedger, event.ledger);
      }

      // Update indexer state with the highest ledger processed
      if (maxLedger > fromLedger) {
        await this.updateIndexerState(maxLedger, 'active', null, client);
      }

      await client.query('COMMIT');
      console.log(`[ContractEventIndexer] Indexed ${insertedCount} events, skipped ${skippedCount} duplicates`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Fetch events from Soroban RPC
   */
  private async fetchEventsFromRPC(contractId: string, startLedger: number): Promise<SorobanEvent[]> {
    try {
      const response = await fetch(this.RPC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getEvents',
          params: {
            startLedger: startLedger + 1,
            filters: [
              {
                type: 'contract',
                contractIds: [contractId],
              },
            ],
            pagination: {
              limit: this.BATCH_SIZE,
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { error?: { message?: string }; result?: GetEventsResponse };

      if (data.error) {
        throw new Error(`RPC error: ${data.error.message || 'Unknown RPC error'}`);
      }

      const result: GetEventsResponse = (data.result || {}) as GetEventsResponse;
      return result.events || [];
    } catch (error) {
      console.error(`[ContractEventIndexer] Error fetching events from RPC:`, error);
      throw error;
    }
  }

  /**
   * Insert event into database (idempotent - skips duplicates)
   */
  private async insertEvent(client: PoolClient, event: SorobanEvent): Promise<boolean> {
    try {
      // Parse event data
      const eventType = this.extractEventType(event);
      const payload = this.parseEventPayload(event);
      const eventIndex = this.extractEventIndex(event.id);

      // Default organization_id to 1 for now - in production, map contract to org
      const organizationId = 1;

      const query = `
        INSERT INTO contract_events (
          organization_id,
          contract_id,
          event_type,
          payload,
          ledger_sequence,
          transaction_hash,
          event_index,
          ledger_closed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (contract_id, transaction_hash, event_index) DO NOTHING
        RETURNING id
      `;

      const values = [
        organizationId,
        event.contractId,
        eventType,
        JSON.stringify(payload),
        event.ledger,
        event.txHash,
        eventIndex,
        new Date(event.ledgerClosedAt),
      ];

      const result = await client.query(query, values);
      return result.rowCount !== null && result.rowCount > 0;
    } catch (error) {
      console.error('[ContractEventIndexer] Error inserting event:', error);
      throw error;
    }
  }

  /**
   * Extract event type from Soroban event topics
   */
  private extractEventType(event: SorobanEvent): string {
    // Event type is typically in the first topic
    if (event.topic && event.topic.length > 0) {
      const topic0 = event.topic[0];
      if (!topic0) return event.type || 'unknown';

      const decodedTopic0 = this.decodeSorobanTopic(topic0);
      if (
        typeof decodedTopic0 === 'string' &&
        decodedTopic0.trim().length > 0 &&
        decodedTopic0 !== topic0
      ) {
        return decodedTopic0;
      }

      // Decode base64 topic to string if needed
      try {
        const decoded = Buffer.from(topic0, 'base64').toString('utf-8');
        return decoded || 'unknown';
      } catch {
        return topic0;
      }
    }
    return event.type || 'unknown';
  }

  /**
   * Parse event payload from XDR
   */
  private parseEventPayload(event: SorobanEvent): Record<string, any> {
    const decodedTopics = Array.isArray(event.topic)
      ? event.topic
          .filter((topic): topic is string => typeof topic === 'string')
          .map((topic) => this.decodeSorobanTopic(topic))
      : null;
    const decodedValue = event.value?.xdr ? this.decodeSorobanScVal(event.value.xdr) : null;

    return {
      type: event.type,
      topics: event.topic,
      value: event.value,
      decoded: {
        topics: decodedTopics,
        value: decodedValue,
      },
      inSuccessfulContractCall: event.inSuccessfulContractCall,
      pagingToken: event.pagingToken,
    };
  }

  private decodeSorobanTopic(topicXdrBase64: string): unknown {
    return this.decodeSorobanScVal(topicXdrBase64);
  }

  private decodeSorobanScVal(scValXdrBase64: string): unknown {
    try {
      const scVal = StellarSdk.xdr.ScVal.fromXDR(scValXdrBase64, 'base64');
      const scValToNative = (StellarSdk as any).scValToNative as ((val: any) => unknown) | undefined;

      if (typeof scValToNative === 'function') {
        return this.sanitizeForJson(scValToNative(scVal));
      }

      // Fallback: return a stable string representation instead of failing.
      return { xdr: scValXdrBase64 };
    } catch {
      // Not a valid ScVal XDR (some RPC clients might return plain base64 or strings)
      // Keep raw topic so callers can still inspect it.
      return scValXdrBase64;
    }
  }

  private sanitizeForJson(value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map((item) => this.sanitizeForJson(item));

    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = this.sanitizeForJson(v);
      }
      return out;
    }

    return value;
  }

  /**
   * Extract event index from event ID
   */
  private extractEventIndex(eventId: string): number {
    // Event ID format: "0000123456-0000000001"
    const parts = eventId.split('-');
    const indexPart = parts.length > 1 ? parts[1] : undefined;
    return indexPart ? parseInt(indexPart, 10) : 0;
  }

  /**
   * Get the last indexed ledger from database
   */
  private async getLastIndexedLedger(): Promise<number> {
    const query = `
      SELECT last_indexed_ledger
      FROM indexer_state
      WHERE indexer_name = 'contract_event_indexer'
    `;

    const result = await pool.query(query);
    return result.rows[0]?.last_indexed_ledger || 0;
  }

  /**
   * Update indexer state in database
   */
  private async updateIndexerState(
    ledger: number,
    status: 'active' | 'paused' | 'error',
    errorMessage: string | null,
    client?: PoolClient
  ): Promise<void> {
    const query = `
      UPDATE indexer_state
      SET last_indexed_ledger = $1,
          status = $2,
          error_message = $3,
          last_indexed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE indexer_name = 'contract_event_indexer'
    `;

    const values = [ledger, status, errorMessage];

    if (client) {
      await client.query(query, values);
    } else {
      await pool.query(query, values);
    }
  }
}

// Export singleton instance
export const contractEventIndexer = new ContractEventIndexer();
