import { TenantConfigService } from '../tenantConfigService.js';
import { RedisClient } from '../rateLimitService.js';
import logger from '../../utils/logger.js';

jest.mock('../../config/database.js', () => ({ pool: {} }));
jest.mock('../rateLimitService.js', () => ({ RedisClient: { getInstance: jest.fn() } }));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { warn: jest.fn() },
}));

describe('tenant configuration cache invalidation', () => {
  const query = jest.fn();
  const del = jest.fn();
  const service = new TenantConfigService({ query } as any);
  const key = 'cache:organization-settings:7:liquidity-settings';

  beforeEach(() => {
    jest.resetAllMocks();
    (RedisClient.getInstance as jest.Mock).mockReturnValue({ del });
    del.mockResolvedValue(1);
  });

  it('invalidates the same org after a successful direct setConfig', async () => {
    const saved = { id: 1, config_value: { assetCode: 'USD' } };
    query.mockResolvedValue({ rows: [saved] });
    await expect(service.setConfig(7, 'liquidity_settings', saved.config_value)).resolves.toBe(saved);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(key);
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(del.mock.invocationCallOrder[0]!);
  });

  it('invalidates direct deletes, including stale cache entries when no row remains', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
    await expect(service.deleteConfig(7, 'liquidity_settings')).resolves.toBe(true);
    await expect(service.deleteConfig(7, 'liquidity_settings')).resolves.toBe(false);
    expect(del.mock.calls).toEqual([[key], [key]]);
  });

  it('does not evict for other configurations or for failed database writes', async () => {
    query.mockResolvedValue({ rows: [{}], rowCount: 1 });
    await service.setConfig(7, 'branding', {});
    await service.deleteConfig(7, 'branding');
    query.mockRejectedValue(new Error('database unavailable'));
    await expect(service.setConfig(7, 'liquidity_settings', {})).rejects.toThrow('database unavailable');
    await expect(service.deleteConfig(7, 'liquidity_settings')).rejects.toThrow('database unavailable');
    expect(del).not.toHaveBeenCalled();
  });

  it('preserves committed results when Redis is absent or invalidation fails', async () => {
    const saved = { id: 1 };
    query.mockResolvedValue({ rows: [saved], rowCount: 1 });
    (RedisClient.getInstance as jest.Mock).mockReturnValueOnce(null);
    await expect(service.setConfig(7, 'liquidity_settings', {})).resolves.toBe(saved);
    del.mockRejectedValueOnce(new Error('cache unavailable'));
    await expect(service.deleteConfig(7, 'liquidity_settings')).resolves.toBe(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
