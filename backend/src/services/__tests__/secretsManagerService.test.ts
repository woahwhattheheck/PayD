import {
  AwsSecretsManagerClient,
  StellarSecretProvider,
  type SecretValueClient,
} from '../secretsManagerService';

describe('StellarSecretProvider', () => {
  let now = 0;
  let client: jest.Mocked<SecretValueClient>;

  beforeEach(() => {
    now = 0;
    client = {
      getCurrentSecret: jest.fn(),
    };
  });

  const makeProvider = () =>
    new StellarSecretProvider(client, {
      secretId: 'payd-test/stellar-credentials',
      cacheTtlMs: 1_000,
      refreshBeforeMs: 200,
      now: () => now,
    });

  it('reuses the cached credential before the refresh window', async () => {
    client.getCurrentSecret.mockResolvedValue('secret-v1');
    const provider = makeProvider();

    await expect(provider.getSecret()).resolves.toBe('secret-v1');
    now = 799;
    await expect(provider.getSecret()).resolves.toBe('secret-v1');

    expect(client.getCurrentSecret).toHaveBeenCalledTimes(1);
  });

  it('refreshes AWSCURRENT before expiry so rotation is picked up without downtime', async () => {
    client.getCurrentSecret
      .mockResolvedValueOnce('secret-v1')
      .mockResolvedValueOnce('secret-v2');
    const provider = makeProvider();

    await expect(provider.getSecret()).resolves.toBe('secret-v1');
    now = 800;
    await expect(provider.getSecret()).resolves.toBe('secret-v2');

    expect(client.getCurrentSecret).toHaveBeenCalledTimes(2);
    expect(client.getCurrentSecret).toHaveBeenNthCalledWith(
      2,
      'payd-test/stellar-credentials'
    );
  });

  it('uses a still-valid cached value on transient refresh failure, then fails closed after expiry', async () => {
    client.getCurrentSecret
      .mockResolvedValueOnce('secret-v1')
      .mockRejectedValue(new Error('temporary Secrets Manager failure'));
    const provider = makeProvider();

    await expect(provider.getSecret()).resolves.toBe('secret-v1');

    now = 850;
    await expect(provider.getSecret()).resolves.toBe('secret-v1');

    now = 1_001;
    await expect(provider.getSecret()).rejects.toThrow(
      'temporary Secrets Manager failure'
    );
  });
});


describe('AwsSecretsManagerClient streamed responses', () => {
  it('keeps the request deadline active after headers until JSON body is read', async () => {
    const previousFetch = globalThis.fetch;
    jest.useFakeTimers();
    let bodyStarted = false;
    globalThis.fetch = jest.fn(async (_input, init?: RequestInit) => {
      const signal = init?.signal;
      return {
        ok: true,
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          bodyStarted = true;
          if (!signal) return reject(new Error('missing abort signal'));
          signal.addEventListener('abort', () => reject(new Error('body aborted')), { once: true });
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    try {
      const client = new AwsSecretsManagerClient('us-east-1', async () => ({
        accessKeyId: 'TESTKEY',
        secretAccessKey: 'test-only-signing-key',
      }));
      const pending = client.getCurrentSecret('test/scheduler-credential');
      const assertion = expect(pending).rejects.toThrow('body aborted');
      await jest.advanceTimersByTimeAsync(5_000);
      await assertion;
      expect(bodyStarted).toBe(true);
    } finally {
      globalThis.fetch = previousFetch;
      jest.useRealTimers();
    }
  });
});
