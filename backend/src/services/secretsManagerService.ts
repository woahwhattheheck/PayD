import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface Aws4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

interface Aws4Request {
  host: string;
  path: string;
  service: string;
  region: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

interface Aws4Module {
  sign(request: Aws4Request, credentials: Aws4Credentials): Aws4Request;
}

const aws4 = require('aws4') as Aws4Module;

export interface StellarSecretSource {
  getSecret(): Promise<string>;
}

export interface SecretValueClient {
  getCurrentSecret(secretId: string): Promise<string>;
}

interface EcsCredentialDocument {
  AccessKeyId?: string;
  SecretAccessKey?: string;
  Token?: string;
}

interface SecretsManagerResponse {
  SecretString?: string;
  SecretBinary?: string;
}

interface CacheEntry {
  value: string;
  refreshAt: number;
  expiresAt: number;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_REFRESH_BEFORE_MS = 60 * 1000;
const METADATA_TIMEOUT_MS = 1500;
const AWS_API_TIMEOUT_MS = 5000;

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function loadEcsTaskCredentials(): Promise<Aws4Credentials> {
  const relativeUri = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  const fullUri = process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  if (!relativeUri && !fullUri) {
    throw new Error('ECS task credentials endpoint is not available');
  }

  const endpoint = relativeUri ? `http://169.254.170.2${relativeUri}` : fullUri!;
  const headers: Record<string, string> = {};
  const authorizationToken = process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
  if (authorizationToken) headers.Authorization = authorizationToken;

  const response = await fetchWithTimeout(endpoint, { headers }, METADATA_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`ECS task credential lookup failed with HTTP ${response.status}`);
  }

  const document = (await response.json()) as EcsCredentialDocument;
  if (!document.AccessKeyId || !document.SecretAccessKey) {
    throw new Error('ECS task credential lookup returned an incomplete document');
  }

  return {
    accessKeyId: document.AccessKeyId,
    secretAccessKey: document.SecretAccessKey,
    sessionToken: document.Token,
  };
}

function extractSecretValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('AWS Secrets Manager returned an empty Stellar credential');

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      for (const key of [
        'STELLAR_SOURCE_SECRET',
        'stellar_secret_key',
        'stellarSecretKey',
        'secretKey',
        'secret',
      ]) {
        const candidate = parsed[key];
        if (typeof candidate === 'string' && candidate.trim()) {
          return candidate.trim();
        }
      }
    } catch {
      // Current Terraform stores the credential as a plain string.
    }
  }

  return trimmed;
}

export class AwsSecretsManagerClient implements SecretValueClient {
  constructor(
    private readonly region =
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
    private readonly credentialProvider: () => Promise<Aws4Credentials> =
      loadEcsTaskCredentials
  ) {}

  async getCurrentSecret(secretId: string): Promise<string> {
    const credentials = await this.credentialProvider();
    const request: Aws4Request = {
      host: `secretsmanager.${this.region}.amazonaws.com`,
      path: '/',
      service: 'secretsmanager',
      region: this.region,
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'secretsmanager.GetSecretValue',
      },
      body: JSON.stringify({ SecretId: secretId, VersionStage: 'AWSCURRENT' }),
    };

    aws4.sign(request, credentials);
    const response = await fetchWithTimeout(
      `https://${request.host}${request.path}`,
      {
        method: request.method,
        headers: request.headers,
        body: request.body,
      },
      AWS_API_TIMEOUT_MS
    );

    if (!response.ok) {
      throw new Error(
        `AWS Secrets Manager GetSecretValue failed with HTTP ${response.status}`
      );
    }

    const payload = (await response.json()) as SecretsManagerResponse;
    const raw =
      payload.SecretString ??
      (payload.SecretBinary
        ? Buffer.from(payload.SecretBinary, 'base64').toString('utf8')
        : undefined);
    if (!raw) throw new Error('AWS Secrets Manager returned no secret value');
    return extractSecretValue(raw);
  }
}

export interface StellarSecretProviderOptions {
  secretId?: string;
  cacheTtlMs?: number;
  refreshBeforeMs?: number;
  now?: () => number;
}

export class StellarSecretProvider implements StellarSecretSource {
  private cache: CacheEntry | null = null;
  private refreshPromise: Promise<string> | null = null;
  private readonly secretId: string;
  private readonly cacheTtlMs: number;
  private readonly refreshBeforeMs: number;
  private readonly now: () => number;

  constructor(
    private readonly client: SecretValueClient = new AwsSecretsManagerClient(),
    options: StellarSecretProviderOptions = {}
  ) {
    this.secretId = options.secretId ?? process.env.STELLAR_SECRET_ID ?? '';
    this.cacheTtlMs =
      options.cacheTtlMs ??
      positiveInt(process.env.STELLAR_SECRET_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
    this.refreshBeforeMs = Math.min(
      options.refreshBeforeMs ?? DEFAULT_REFRESH_BEFORE_MS,
      Math.max(1, this.cacheTtlMs - 1)
    );
    this.now = options.now ?? Date.now;
  }

  async getSecret(): Promise<string> {
    if (!this.secretId) {
      throw new Error('STELLAR_SECRET_ID is required for scheduled payments');
    }

    const now = this.now();
    if (this.cache && now < this.cache.refreshAt) return this.cache.value;
    if (this.refreshPromise) return this.refreshPromise;

    const previous = this.cache;
    this.refreshPromise = this.refresh(previous);
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async refresh(previous: CacheEntry | null): Promise<string> {
    try {
      const value = await this.client.getCurrentSecret(this.secretId);
      const loadedAt = this.now();
      this.cache = {
        value,
        refreshAt: loadedAt + this.cacheTtlMs - this.refreshBeforeMs,
        expiresAt: loadedAt + this.cacheTtlMs,
      };
      return value;
    } catch (error) {
      if (previous && this.now() < previous.expiresAt) {
        return previous.value;
      }
      throw error;
    }
  }
}

export const stellarSecretProvider = new StellarSecretProvider();
