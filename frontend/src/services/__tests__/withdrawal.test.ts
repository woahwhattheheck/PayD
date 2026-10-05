import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';
import withdrawalService from '../withdrawal';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('withdrawalService', () => {
  it('propagates anchor discovery failures instead of returning fallback data', async () => {
    const failure = new Error('Network Error');
    vi.spyOn(axios, 'get').mockRejectedValueOnce(failure);

    await expect(withdrawalService.getAvailableAnchors()).rejects.toBe(failure);
  });

  it('propagates withdrawal initiation failures instead of returning a fake transaction', async () => {
    const failure = new Error('Request failed with status code 500');
    vi.spyOn(axios, 'post').mockRejectedValueOnce(failure);

    await expect(
      withdrawalService.initiateWithdrawal({
        anchorDomain: 'anchor.ng',
        assetCode: 'ORGUSD',
        amount: 25,
        destinationType: 'bank_account',
        destinationDetails: { account: '0123456789' },
      })
    ).rejects.toBe(failure);
  });

  it('propagates transaction status failures instead of returning a fake success', async () => {
    const failure = new Error('Request failed with status code 500');
    vi.spyOn(axios, 'get').mockRejectedValueOnce(failure);

    await expect(withdrawalService.getTransactionStatus('tx-1', 'anchor.ng')).rejects.toBe(failure);
  });

  it('propagates cancellation failures instead of resolving silently', async () => {
    const failure = new Error('Network Error');
    vi.spyOn(axios, 'post').mockRejectedValueOnce(failure);

    await expect(withdrawalService.cancelWithdrawal('tx-1')).rejects.toBe(failure);
  });
});
