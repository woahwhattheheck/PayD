import { ContractEventIndexer } from '../contractEventIndexer';
import { default as pool } from '../../config/database';
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
    (global.fetch as jest.Mock).mockReset();
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

  describe('behavior preserved from the removed indexer', () => {
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
        topic: ['cGF5bWVudA=='],
        value: { xdr: 'test' },
        inSuccessfulContractCall: true,
        txHash: index.toString(16).padStart(64, '0'),
      };
    }

    function rpcPage(events: SorobanEvent[], latestLedger = 100) {
      return { ok: true, json: async () => ({ result: { events, latestLedger } }) };
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

    it('drains a full RPC page via cursor before advancing the shared ledger checkpoint', async () => {
      const firstPage = Array.from({ length: 100 }, (_, i) => indexedEvent(i + 1, 100));
      const lastEvent = indexedEvent(101, 100);
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: { events: firstPage, cursor: 'next-page', latestLedger: 100 } }),
        })
        .mockResolvedValueOnce(rpcPage([lastEvent]));

      await indexer.initialize();

      expect(global.fetch).toHaveBeenCalledTimes(2);
      const firstParams = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).params;
      const secondParams = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body).params;
      expect(firstParams.startLedger).toBe(100);
      expect(firstParams.pagination.cursor).toBeUndefined();
      expect(secondParams.startLedger).toBeUndefined();
      expect(secondParams.pagination.cursor).toBe('next-page');
      const inserts = mockClient.query.mock.calls.filter(
        ([sql]: [string]) => sql.includes('INSERT INTO contract_events')
      );
      expect(inserts).toHaveLength(101);
      expect(checkpoint).toBe(100);
    });

    it('does not insert any partial page or advance the checkpoint if a later RPC page fails', async () => {
      const firstPage = Array.from({ length: 100 }, (_, i) => indexedEvent(i + 1, 100));
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: { events: firstPage, cursor: 'next-page', latestLedger: 100 } }),
        })
        .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' });

      await indexer.initialize();

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(mockClient.query).not.toHaveBeenCalled();
      expect(checkpoint).toBe(99);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE indexer_state'),
        [99, 'error', expect.stringContaining('RPC request failed: 503')]
      );
    });

    it('increments a string ledger numerically and commits one combined contract batch', async () => {
      const events = [indexedEvent(1), indexedEvent(2), indexedEvent(3)];
      (global.fetch as jest.Mock).mockResolvedValue(rpcPage(events));

      await indexer.initialize();

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const params = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).params;
      expect(params.startLedger).toBe(100);
      expect(params.filters[0].contractIds).toEqual(contractIds);
      const writes = mockClient.query.mock.calls;
      expect(writes.filter(([sql]: [string]) => sql.includes('INSERT INTO contract_events'))).toHaveLength(3);
      expect(writes[0]).toEqual(['BEGIN']);
      expect(writes[writes.length - 2][1]).toEqual([100, 'active', null]);
      expect(writes[writes.length - 1]).toEqual(['COMMIT']);
      expect(writes.filter(([sql]: [string]) => sql.includes('UPDATE indexer_state'))).toHaveLength(1);
      expect(checkpoint).toBe(100);
    });

    it('preserves both contracts when a ledger arrives after an empty response', async () => {
      let visibleEvents: SorobanEvent[] = [];
      let latestLedger = 100;
      const arrivals = [indexedEvent(3, 101), indexedEvent(4, 101)];
      (global.fetch as jest.Mock).mockImplementation(async (_url: string, options: RequestInit) => {
        const params = JSON.parse(options.body as string).params;
        const events = visibleEvents.filter((event) =>
          event.ledger >= params.startLedger && params.filters[0].contractIds.includes(event.contractId)
        );
        const response = rpcPage(events, latestLedger);
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

    it('prevents an overlapping poll from reverting a completed checkpoint', async () => {
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
      releaseFirst(rpcPage([indexedEvent(3)]));
      await initializing;
      releaseSecond({ ok: false, status: 500, statusText: 'late failure' });
      await overlapping;

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(checkpoint).toBe(100);
      expect(mockClient.query).toHaveBeenLastCalledWith('COMMIT');
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
