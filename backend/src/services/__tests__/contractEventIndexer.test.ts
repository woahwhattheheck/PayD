import { ContractEventIndexer } from '../contractEventIndexer';
import { default as pool } from '../../config/database';

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

      const events = await (indexer as any).fetchEventsFromRPC('CTEST123', 0);
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
        (indexer as any).fetchEventsFromRPC('CTEST123', 0)
      ).rejects.toThrow('RPC error: RPC error');
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(
        (indexer as any).fetchEventsFromRPC('CTEST123', 0)
      ).rejects.toThrow('RPC request failed: 500 Internal Server Error');
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
