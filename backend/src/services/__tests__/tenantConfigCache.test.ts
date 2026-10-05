import { TenantConfigService } from '../tenantConfigService.js';
import { RedisClient } from '../rateLimitService.js';
import logger from '../../utils/logger.js';

jest.mock('../../config/database.js', () => ({ pool: {} }));
jest.mock('../rateLimitService.js', () => ({ RedisClient: { getInstance: jest.fn() } }));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn() },
}));

describe('tenant configuration cache', () => {
  const query = jest.fn();
  const get = jest.fn();
  const setex = jest.fn();
  const del = jest.fn();
  const redis = { get, setex, del };
  const service = new TenantConfigService({ query } as any);

  beforeEach(() => {
    jest.resetAllMocks();
    (RedisClient.getInstance as jest.Mock).mockReturnValue(redis);
    setex.mockResolvedValue('OK');
    del.mockResolvedValue(2);
  });

  it('returns a cached setting without querying PostgreSQL', async () => {
    get.mockResolvedValue(JSON.stringify({ primary_color: '#123456' }));

    await expect(service.getConfig(7, 'branding')).resolves.toEqual({
      primary_color: '#123456',
    });

    expect(get).toHaveBeenCalledWith('cache:organization-settings:7:branding');
    expect(query).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('Cache hit', {
      cache: 'organization-settings',
      organizationId: 7,
      configKey: 'branding',
    });
  });

  it('caches a database miss for any configuration key for 30 minutes', async () => {
    get.mockResolvedValue(null);
    query.mockResolvedValue({ rows: [{ config_value: { email_notifications: true } }] });

    await expect(service.getConfig(7, 'notification_settings')).resolves.toEqual({
      email_notifications: true,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(setex).toHaveBeenCalledWith(
      'cache:organization-settings:7:notification_settings',
      30 * 60,
      JSON.stringify({ email_notifications: true })
    );
  });

  it('caches and reuses the aggregate tenant settings view', async () => {
    get.mockResolvedValueOnce(null).mockResolvedValueOnce(
      JSON.stringify({ branding: { primary_color: '#fff' } })
    );
    query.mockResolvedValue({
      rows: [{ config_key: 'branding', config_value: { primary_color: '#fff' } }],
    });

    await expect(service.getAllConfigs(7)).resolves.toEqual({
      branding: { primary_color: '#fff' },
    });
    await expect(service.getAllConfigs(7)).resolves.toEqual({
      branding: { primary_color: '#fff' },
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(setex).toHaveBeenCalledWith(
      'cache:organization-settings:7:all',
      30 * 60,
      JSON.stringify({ branding: { primary_color: '#fff' } })
    );
  });

  it('invalidates the changed key and aggregate cache after successful writes', async () => {
    const saved = { id: 1, config_value: { primary_color: '#000' } };
    query
      .mockResolvedValueOnce({ rows: [saved] })
      .mockResolvedValueOnce({ rowCount: 1 });

    await expect(service.setConfig(7, 'branding', saved.config_value)).resolves.toBe(saved);
    await expect(service.deleteConfig(7, 'branding')).resolves.toBe(true);

    expect(del.mock.calls).toEqual([
      ['cache:organization-settings:7:branding', 'cache:organization-settings:7:all'],
      ['cache:organization-settings:7:branding', 'cache:organization-settings:7:all'],
    ]);
  });

  it('falls back to PostgreSQL when Redis fails and never rolls back a committed write', async () => {
    const saved = { id: 1, config_value: { require_2fa: true } };
    get.mockRejectedValueOnce(new Error('cache read failed'));
    query
      .mockResolvedValueOnce({ rows: [{ config_value: saved.config_value }] })
      .mockResolvedValueOnce({ rows: [saved] });
    setex.mockRejectedValueOnce(new Error('cache write failed'));
    del.mockRejectedValueOnce(new Error('cache invalidate failed'));

    await expect(service.getConfig(7, 'security_settings')).resolves.toEqual(saved.config_value);
    await expect(service.setConfig(7, 'security_settings', saved.config_value)).resolves.toBe(saved);

    expect(logger.warn).toHaveBeenCalledTimes(3);
  });
});
