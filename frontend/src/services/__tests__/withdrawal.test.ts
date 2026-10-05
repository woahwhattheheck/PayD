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
    vi.mocked(axios.get).mockRejectedValueOnce(failure);

    await expect(withdrawalService.getAvailableAnchors()).rejects.toBe(failure);
  });
});
