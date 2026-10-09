import { parseEnvironment } from '../env.js';
describe('central backend environment contract', () => {
  test('development uses safe local defaults', () => {
    const values = parseEnvironment({ NODE_ENV: 'development' });
    expect(values.PORT).toBe('3001');
    expect(values.SDS_ENABLE).toBe('false');
  });
  test('production rejects default DB and JWT credentials', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'production' })).toThrow();
    expect(parseEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://app:pass@db.internal:5432/payd',
      JWT_SECRET: 'configured-jwt-secret',
      JWT_REFRESH_SECRET: 'configured-jwt-refresh',
    }).NODE_ENV).toBe('production');
  });
  test('bad numeric values or missing external provider config fail fast', () => {
    expect(() => parseEnvironment({ PORT: '0' })).toThrow();
    expect(() => parseEnvironment({ DB_PORT: 'wrong' })).toThrow();
    expect(() => parseEnvironment({ TAX_COMPLIANCE_PROVIDER: 'external_compliance_api' })).toThrow();
  });
});
