import { ContractEventIndexer } from '../contractEventIndexer';
import { default as pool } from '../../config/database';

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: { connect: jest.fn(), query: jest.fn() },
}));

const contractKeys = [
  'BULK_PAYMENT_CONTRACT_ID',
  'VESTING_ESCROW_CONTRACT_ID',
  'REVENUE_SPLIT_CONTRACT_ID',
] as const;

describe('ContractEventIndexer contract configuration', () => {
  const originalIds = contractKeys.map((key) => process.env[key]);
  const originalFetch = global.fetch;
  let indexer: ContractEventIndexer | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    contractKeys.forEach((key) => delete process.env[key]);
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { events: [] } }),
    });
  });

  afterEach(() => {
    indexer?.stop();
    indexer = undefined;
    contractKeys.forEach((key, index) => {
      const value = originalIds[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('trims and deduplicates configured IDs before requesting events', async () => {
    process.env.BULK_PAYMENT_CONTRACT_ID = ' CTEST123 ';
    process.env.VESTING_ESCROW_CONTRACT_ID = 'CTEST123';
    process.env.REVENUE_SPLIT_CONTRACT_ID = '\t\n';
    indexer = new ContractEventIndexer();

    await indexer.initialize();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, request] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(request.body).params.filters).toEqual([
      { type: 'contract', contractIds: ['CTEST123'] },
    ]);
    expect(process.env.BULK_PAYMENT_CONTRACT_ID).toBe(' CTEST123 ');
  });

  it('stays idle when all IDs are missing or whitespace-only', async () => {
    process.env.BULK_PAYMENT_CONTRACT_ID = '  ';
    process.env.VESTING_ESCROW_CONTRACT_ID = '\t\n';
    indexer = new ContractEventIndexer();

    await indexer.initialize();

    expect(pool.query).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('preserves the order and spelling of distinct configured IDs', async () => {
    process.env.BULK_PAYMENT_CONTRACT_ID = 'CTEST_B';
    process.env.VESTING_ESCROW_CONTRACT_ID = 'CTEST_A';
    process.env.REVENUE_SPLIT_CONTRACT_ID = 'CTEST_C';
    indexer = new ContractEventIndexer();

    await indexer.initialize();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, request] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(request.body).params.filters).toEqual([
      { type: 'contract', contractIds: ['CTEST_B', 'CTEST_A', 'CTEST_C'] },
    ]);
  });
});
