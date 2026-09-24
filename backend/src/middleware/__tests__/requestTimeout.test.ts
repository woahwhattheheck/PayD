import { describe, it, expect } from 'vitest';
import { __test__ } from '../requestTimeout.js';

describe('requestTimeout bulk path detection', () => {
  it('uses bulk timeout for bulk/batch/import/export routes', () => {
    expect(__test__.isBulkPath('/api/v1/payroll/bulk')).toBe(true);
    expect(__test__.isBulkPath('/api/employees/batch')).toBe(true);
    expect(__test__.isBulkPath('/api/import')).toBe(true);
    expect(__test__.isBulkPath('/api/export/csv')).toBe(true);
  });

  it('uses default timeout otherwise', () => {
    expect(__test__.isBulkPath('/api/v1/employees')).toBe(false);
    expect(__test__.isBulkPath('/health')).toBe(false);
  });

  it('exposes expected timeout constants', () => {
    expect(__test__.DEFAULT_TIMEOUT_MS).toBe(30_000);
    expect(__test__.BULK_TIMEOUT_MS).toBe(120_000);
  });
});
