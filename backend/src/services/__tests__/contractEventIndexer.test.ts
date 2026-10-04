import { ContractEventIndexer } from '../contractEventIndexer';
import { default as pool } from '../../config/database';
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import type { SorobanEvent } from '../../types/contractEvent';

// Mock the database pool
jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    query: jest.fn(),
  },
}));

// Mock fetch
global.fetch = jest.fn();

describe('ContractEventIndexer', () => {
  let indexer: ContractEventIndexer;
  let mockClient: any;

  beforeEach(() => {
    indexer = new ContractEventIndexer();
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    (pool.connect as jest.Mock).mockResolvedValue(mockClient);
    jest.clearAllMocks();
  });

  afterEach(() => {
    indexer.stop();
  });

  describe('getLastIndexedLedger', () => {
    it('should return last indexed ledger from database', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [{ last_indexed_ledger: 12345 }],
      });

      const result = await (indexer as any).getLastIndexedLedger();
      expect(result).toBe(12345);
    });

    it('should return 0 if no state exists', async () => {
      (pool.query as jest.Mock).mockResolvedValue({
        rows: [],
      });

      const result = await (indexer as any).getLastIndexedLedger();
      expect(result).toBe(0);
    });
  });

  describe('extractEventType', () => {
    it('should extract event type from topics', () => {
      const event = {
        type: 'contract',
        topic: ['cGF5bWVudA=='], // base64 for "payment"
        ledger: 100,
        ledgerClosedAt: '2024-01-01T00:00:00Z',
        contractId: 'CTEST123',
        id: '0000000100-0000000001',
        pagingToken: 'token',
        value: { xdr: 'test' },
        inSuccessfulContractCall: true,
        txHash: 'hash123',
      };

      const eventType = (indexer as any).extractEventType(event);
      expect(eventType).toBe('payment');
    });

    it('should return unknown if no topics', () => {
      const event = {
        type: 'contract',
        topic: [],
        ledger: 100,
        ledgerClosedAt: '2024-01-01T00:00:00Z',
        contractId: 'CTEST123',
        id: '0000000100-0000000001',
        pagingToken: 'token',
        value: { xdr: 'test' },
        inSuccessfulContractCall: true,
        txHash: 'hash123',
      };

      const eventType = (indexer as any).extractEventType(event);
      expect(eventType).toBe('contract');
    });
  });

  describe('extractEventIndex', () => {
    it('should extract event index from event ID', () => {
      const eventId = '0000123456-0000000005';
      const index = (indexer as any).extractEventIndex(eventId);
      expect(index).toBe(5);
    });

    it('should return 0 for invalid format', () => {
      const eventId = 'invalid';
      const index = (indexer as any).extractEventIndex(eventId);
      expect(index).toBe(0);
    });
  });

  describe('insertEvent', () => {
    it('should insert event and return true on success', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 1 });

      const event = {
        type: 'contract',
        topic: ['payment'],
        ledger: 100,
        ledgerClosedAt: '2024-01-01T00:00:00Z',
        contractId: 'CTEST123',
        id: '0000000100-0000000001',
        pagingToken: 'token',
        value: { xdr: 'test' },
        inSuccessfulContractCall: true,
        txHash: 'hash123',
      };

      const result = await (indexer as any).insertEvent(mockClient, event);
      expect(result).toBe(true);
      expect(mockClient.query).toHaveBeenCalled();
    });

    it('should return false on duplicate (conflict)', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 0 });

      const event = {
        type: 'contract',
        topic: ['payment'],
        ledger: 100,
        ledgerClosedAt: '2024-01-01T00:00:00Z',
        contractId: 'CTEST123',
        id: '0000000100-0000000001',
        pagingToken: 'token',
        value: { xdr: 'test' },
        inSuccessfulContractCall: true,
        txHash: 'hash123',
      };

      const result = await (indexer as any).insertEvent(mockClient, event);
      expect(result).toBe(false);
    });
  });

  describe('fetchEventsFromRPC', () => {
    it('should fetch events from Soroban RPC', async () => {
      const mockEvents = [
        {
          type: 'contract',
          topic: ['payment'],
          ledger: 100,
          ledgerClosedAt: '2024-01-01T00:00:00Z',
          contractId: 'CTEST123',
          id: '0000000100-0000000001',
          pagingToken: 'token',
          value: { xdr: 'test' },
          inSuccessfulContractCall: true,
          txHash: 'hash123',
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            events: mockEvents,
            latestLedger: 100,
          },
        }),
      });

      const events = await (indexer as any).fetchEventsFromRPC(['CTEST123'], 0);
      expect(events).toEqual(mockEvents);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should handle RPC errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          error: { message: 'RPC error' },
        }),
      });

      await expect(
        (indexer as any).fetchEventsFromRPC(['CTEST123'], 0)
      ).rejects.toThrow('RPC error: RPC error');
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(
        (indexer as any).fetchEventsFromRPC(['CTEST123'], 0)
      ).rejects.toThrow('RPC request failed: 500 Internal Server Error');
    });
  });

  describe('lossless RPC pagination', () => {
    const contractIds = ['CBULK', 'CVESTING', 'CREVENUE'];
    const contractEnvNames = [
      'BULK_PAYMENT_CONTRACT_ID',
      'VESTING_ESCROW_CONTRACT_ID',
      'REVENUE_SPLIT_CONTRACT_ID',
    ] as const;

    function indexedEvent(index: number, ledger = 100): SorobanEvent {
      const id = `${String(ledger).padStart(10, '0')}-${String(index).padStart(10, '0')}`;
      return {
        type: 'contract',
        ledger,
        ledgerClosedAt: '2026-10-04T00:00:00Z',
        contractId: contractIds[index % contractIds.length]!,
        id,
        pagingToken: id,
        topic: [nativeToScVal('payment', { type: 'symbol' }).toXDR('base64')],
        value: nativeToScVal(index, { type: 'u32' }).toXDR('base64'),
        inSuccessfulContractCall: true,
        txHash: index.toString(16).padStart(64, '0'),
      };
    }

    function rpcPage(events: SorobanEvent[], cursor?: string, latestLedger = 100) {
      return {
        ok: true,
        json: async () => ({ result: { events, latestLedger, cursor } }),
      };
    }

    let checkpoint: number;
    let savedContractEnv: (string | undefined)[];

    beforeEach(() => {
      savedContractEnv = contractEnvNames.map((name) => process.env[name]);
      contractEnvNames.forEach((name, index) => { process.env[name] = contractIds[index]; });
      indexer = new ContractEventIndexer();
      checkpoint = 99;
      (global.fetch as jest.Mock).mockReset();
      (pool.query as jest.Mock).mockImplementation(async (sql: string, values?: any[]) => {
        if (sql.includes('UPDATE indexer_state')) checkpoint = values![0];
        return { rows: [{ last_indexed_ledger: String(checkpoint) }] };
      });
      mockClient.query.mockImplementation(async (sql: string, values?: any[]) => {
        if (sql.includes('UPDATE indexer_state')) checkpoint = values![0];
        return { rowCount: 1 };
      });
    });

    afterEach(() => {
      indexer.stop();
      contractEnvNames.forEach((name, index) => {
        const value = savedContractEnv[index];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      });
    });

    it('indexes every event in a full ledger and defers arrivals beyond the initial RPC head', async () => {
      const firstLedger = Array.from({ length: 101 }, (_, i) => indexedEvent(i + 1));
      const nextLedger = Array.from({ length: 99 }, (_, i) => indexedEvent(i + 102, 101));
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(rpcPage(firstLedger.slice(0, 100), 'page-1'))
        .mockResolvedValueOnce(rpcPage([firstLedger[100]!, ...nextLedger], 'page-2', 101))
        .mockResolvedValueOnce(rpcPage(nextLedger, undefined, 101));

      await indexer.initialize();

      const requests = (global.fetch as jest.Mock).mock.calls.map(([, options]) => JSON.parse(options.body).params);
      expect(requests).toHaveLength(2);
      expect(requests[0].startLedger).toBe(100); // pg returns BIGINT checkpoint "99".
      expect(requests[1].pagination).toEqual({ limit: 100, cursor: 'page-1' });
      expect(requests[1]).not.toHaveProperty('startLedger');
      expect(requests[1]).not.toHaveProperty('endLedger');
      requests.forEach((params) => expect(params.filters[0].contractIds).toEqual(contractIds));
      const inserts = mockClient.query.mock.calls.filter(([sql]: [string]) => sql.includes('INSERT INTO contract_events'));
      expect(inserts).toHaveLength(101);
      expect(new Set(inserts.map(([, values]: [string, any[]]) => values[5])).size).toBe(101);
      expect(inserts.every(([, values]: [string, any[]]) => values[4] === 100)).toBe(true);
      expect(checkpoint).toBe(100);
      const writes = mockClient.query.mock.calls;
      expect(writes[0]).toEqual(['BEGIN']);
      expect(writes[writes.length - 2][1]).toEqual([100, 'active', null]);
      expect(writes[writes.length - 1]).toEqual(['COMMIT']);
      expect(writes.filter(([sql]: [string]) => sql.includes('UPDATE indexer_state'))).toHaveLength(1);

      await indexer.pollOnce();

      const nextRequest = JSON.parse((global.fetch as jest.Mock).mock.calls[2][1].body).params;
      expect(nextRequest.startLedger).toBe(101);
      expect(checkpoint).toBe(101);
      expect(mockClient.query.mock.calls.filter(([sql]: [string]) => sql.includes('INSERT INTO contract_events'))).toHaveLength(200);
    });

    it.each(['RPC error', 'missing cursor', 'repeated cursor', 'invalid page'])('keeps the checkpoint and retries after a %s', async (failure) => {
      const events = Array.from({ length: 101 }, (_, i) => indexedEvent(i + 1));
      const firstPage = events.slice(0, 100);
      (global.fetch as jest.Mock).mockResolvedValueOnce(rpcPage(firstPage, failure === 'missing cursor' ? undefined : 'page-1'));
      if (failure === 'RPC error') {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async () => ({ error: { message: 'continuation unavailable' } }),
        });
      } else if (failure === 'repeated cursor') {
        (global.fetch as jest.Mock).mockResolvedValueOnce(rpcPage(firstPage, 'page-1'));
      } else if (failure === 'invalid page') {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: {} }),
        });
      }

      await indexer.initialize();

      expect(checkpoint).toBe(99);
      expect(pool.connect).not.toHaveBeenCalled();
      expect(mockClient.query).not.toHaveBeenCalled(); // No BEGIN before all pages arrive.
      expect(pool.query).toHaveBeenLastCalledWith(
        expect.stringContaining('UPDATE indexer_state'),
        [99, 'error', expect.stringMatching(/continuation unavailable|pagination cursor|valid events page/)]
      );

      (global.fetch as jest.Mock).mockReset()
        .mockResolvedValueOnce(rpcPage(firstPage, 'page-1'))
        .mockResolvedValueOnce(rpcPage(events.slice(100), 'page-2'));
      await indexer.pollOnce();

      expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).params.startLedger).toBe(100);
      expect(checkpoint).toBe(100);
      expect(mockClient.query.mock.calls.filter(([sql]: [string]) => sql.includes('INSERT INTO contract_events'))).toHaveLength(101);
      expect(mockClient.query).toHaveBeenLastCalledWith('COMMIT');
    });

    it('keeps all contracts visible when a new ledger arrives after an empty response', async () => {
      let visibleEvents: SorobanEvent[] = [];
      let latestLedger = 100;
      const arrivals = [indexedEvent(3, 101), indexedEvent(4, 101)];
      (global.fetch as jest.Mock).mockImplementation(async (_url: string, options: RequestInit) => {
        const params = JSON.parse(options.body as string).params;
        const events = visibleEvents.filter((event) =>
          event.ledger >= params.startLedger && params.filters[0].contractIds.includes(event.contractId)
        );
        const response = rpcPage(events, undefined, latestLedger);
        visibleEvents = arrivals;
        latestLedger = 101;
        return response;
      });

      await indexer.initialize();
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(checkpoint).toBe(99);
      await indexer.pollOnce();

      const inserts = mockClient.query.mock.calls.filter(([sql]: [string]) => sql.includes('INSERT INTO contract_events'));
      expect(inserts).toHaveLength(2);
      expect(inserts.map(([, values]: [string, any[]]) => values[1])).toEqual(arrivals.map((event) => event.contractId));
      expect(checkpoint).toBe(101);
    });

    it('prevents an overlapping poll from overwriting a completed checkpoint', async () => {
      let releaseFirst!: (response: any) => void;
      let releaseSecond!: (response: any) => void;
      let markStarted!: () => void;
      const firstResponse = new Promise((resolve) => { releaseFirst = resolve; });
      const secondResponse = new Promise((resolve) => { releaseSecond = resolve; });
      const started = new Promise<void>((resolve) => { markStarted = resolve; });
      (global.fetch as jest.Mock)
        .mockImplementationOnce(() => { markStarted(); return firstResponse; })
        .mockImplementationOnce(() => secondResponse);

      const initializing = indexer.initialize();
      await started;
      const overlapping = indexer.pollOnce();
      await Promise.resolve();
      releaseFirst(rpcPage([indexedEvent(1)]));
      await initializing;
      releaseSecond({ ok: false, status: 500, statusText: 'late failure' });
      await overlapping;

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(checkpoint).toBe(100);
      expect(mockClient.query).toHaveBeenLastCalledWith('COMMIT');
    });
  });

  describe('distribution event RPC payloads', () => {
    const asset = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
    const totalAmount = 9007199254740993n;

    function distributionEvent(): SorobanEvent {
      const fields = [
        ['asset', new Address(asset).toScVal()],
        ['recipient_count', xdr.ScVal.scvU32(2)],
        ['split_percentages', xdr.ScVal.scvVec([xdr.ScVal.scvU32(6000), xdr.ScVal.scvU32(4000)])],
        ['total_amount', nativeToScVal(totalAmount, { type: 'i128' })],
      ] as const;
      return {
        type: 'contract',
        ledger: 100,
        ledgerClosedAt: '2026-10-04T00:00:00Z',
        contractId: asset,
        id: '0000000100000000000-0000000001',
        pagingToken: '0000000100000000000-0000000001',
        topic: [nativeToScVal('distribution_executed_event', { type: 'symbol' }).toXDR('base64')],
        value: xdr.ScVal.scvMap(fields.map(([name, value]) => new xdr.ScMapEntry({
          key: nativeToScVal(name, { type: 'symbol' }),
          val: value,
        }))).toXDR('base64'),
        inSuccessfulContractCall: true,
        txHash: 'a'.repeat(64),
      };
    }

    it.each(['raw', 'legacy wrapper'])('indexes %s XDR through a poll without losing event fields', async (encoding) => {
      const event = distributionEvent();
      if (encoding === 'legacy wrapper') event.value = { xdr: event.value as string };
      (indexer as any).CONTRACTS_TO_INDEX = [event.contractId];
      (indexer as any).isRunning = true;
      (pool.query as jest.Mock).mockResolvedValue({ rows: [{ last_indexed_ledger: 99 }] });
      mockClient.query.mockResolvedValue({ rowCount: 1 });
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ result: { events: [event], latestLedger: 100 } }),
      });

      await indexer.pollOnce();

      const insert = mockClient.query.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO contract_events'));
      expect(insert).toBeDefined();
      const values = insert[1];
      expect(values[2]).toBe('distribution_executed_event');
      const payload = JSON.parse(values[3]);
      expect(payload.value).toEqual(event.value);
      expect(payload.decoded.value).toEqual({
        asset,
        recipient_count: 2,
        split_percentages: [6000, 4000],
        total_amount: totalAmount.toString(),
      });
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it.each(['raw', 'legacy wrapper'])('preserves malformed %s XDR without throwing', (encoding) => {
      const event = distributionEvent();
      event.value = encoding === 'raw' ? 'invalid-xdr' : { xdr: 'invalid-xdr' };

      const payload = (indexer as any).parseEventPayload(event);

      expect(payload.value).toEqual(event.value);
      expect(payload.decoded.value).toBe('invalid-xdr');
    });
  });

  describe('updateIndexerState', () => {
    it('should update indexer state', async () => {
      await (indexer as any).updateIndexerState(12345, 'active', null);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE indexer_state'),
        [12345, 'active', null]
      );
    });

    it('should update with error message', async () => {
      await (indexer as any).updateIndexerState(12345, 'error', 'Test error');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE indexer_state'),
        [12345, 'error', 'Test error']
      );
    });
  });
});
