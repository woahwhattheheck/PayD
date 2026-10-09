import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

// All backend runtime values share one Zod schema. Development uses testnet
// defaults, but production refuses placeholder database and JWT credentials.
const positiveInteger = z.string().regex(/^[1-9][0-9]*$/, 'must be a positive integer');
const nonNegativeInteger = z.string().regex(/^(0|[1-9][0-9]*)$/, 'must be a non-negative integer');
const portString = positiveInteger.refine((value) => Number(value) <= 65535, 'invalid TCP port');
const baseEnvSchema = z.object({
  PORT: portString.default("3001"),
  NODE_ENV: z.enum(['development', 'production', 'test']).default("development"),
  DATABASE_URL: z.string().min(1).default("postgres://localhost:5432/payd_test"),
  REDIS_URL: z.string().optional(),
  DB_HOST: z.string().min(1).default("localhost"),
  DB_PORT: portString.default("5432"),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_NAME: z.string().min(1).default("payd_db"),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  FRONTEND_URL: z.string().min(1).default("http://localhost:5173"),
  JWT_SECRET: z.string().min(1).default("dev-jwt-secret"),
  JWT_REFRESH_SECRET: z.string().min(1).default("dev-jwt-refresh-secret"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  TWO_FACTOR_ENCRYPTION_KEY: z.string().optional(),
  TWO_FACTOR_ISSUER: z.string().min(1).default("PayD"),
  AUDIT_LOGGING_ENABLED: z.enum(['true', 'false', '1', '0']).default("true"),
  ADVANCED_RATE_LIMIT_ENABLED: z.enum(['true', 'false', '1', '0']).default("true"),
  TENANT_ISOLATION_STRICT_MODE: z.enum(['true', 'false', '1', '0']).default("true"),
  RATE_LIMIT_LOG_VIOLATIONS: z.enum(['true', 'false', '1', '0']).default("true"),
  REQUEST_ID_PREFIX: z.string().min(1).default("payd"),
  THROTTLING_TPM: positiveInteger.default("100"),
  THROTTLING_MAX_QUEUE_SIZE: positiveInteger.default("1000"),
  THROTTLING_REFILL_INTERVAL_MS: positiveInteger.default("1000"),
  RATE_LIMIT_AUTH_WINDOW_MS: positiveInteger.default("900000"),
  RATE_LIMIT_AUTH_MAX: positiveInteger.default("10"),
  RATE_LIMIT_API_WINDOW_MS: positiveInteger.default("60000"),
  RATE_LIMIT_API_MAX: positiveInteger.default("100"),
  RATE_LIMIT_DATA_WINDOW_MS: positiveInteger.default("60000"),
  RATE_LIMIT_DATA_MAX: positiveInteger.default("200"),
  STELLAR_NETWORK: z.string().min(1).default("testnet"),
  STELLAR_NETWORK_PASSPHRASE: z.string().min(1).default("Test SDF Network ; September 2015"),
  STELLAR_HORIZON_URL: z.string().url().default("https://horizon-testnet.stellar.org"),
  STELLAR_RPC_URL: z.string().url().default("https://soroban-testnet.stellar.org"),
  SOROBAN_RPC_URL: z.string().url().default("https://soroban-testnet.stellar.org"),
  STELLAR_SOURCE_SECRET: z.string().optional(),
  STELLAR_ASSET_ISSUER: z.string().optional(),
  BULK_PAYMENT_CONTRACT_ID: z.string().optional(),
  VESTING_ESCROW_CONTRACT_ID: z.string().optional(),
  REVENUE_SPLIT_CONTRACT_ID: z.string().optional(),
  SOROBAN_EVENT_START_LEDGER: nonNegativeInteger.default("0"),
  SOROBAN_EVENT_POLL_INTERVAL_MS: positiveInteger.default("12000"),
  SDS_ENABLE: z.enum(['true', 'false', '1', '0']).default("false"),
  SDS_API_KEY: z.string().optional(),
  SDS_ENDPOINT: z.string().url().default("https://sds-api.stellar.org"),
  SDS_TIMEOUT: positiveInteger.default("30000"),
  SDS_RETRY_ATTEMPTS: nonNegativeInteger.default("3"),
  SDS_RETRY_DELAY: nonNegativeInteger.default("1000"),
  ENABLE_CACHING: z.enum(['true', 'false', '1', '0']).default("false"),
  CACHE_TTL: positiveInteger.default("3600"),
  LOG_LEVEL: z.string().min(1).default("info"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: portString.default("587"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: z.enum(['true', 'false', '1', '0']).default("false"),
  TAX_COMPLIANCE_PROVIDER: z.string().min(1).default("local_rule_based"),
  TAX_COMPLIANCE_API_BASE_URL: z.string().optional(),
  TAX_COMPLIANCE_API_KEY: z.string().optional(),
  TAX_COMPLIANCE_API_TIMEOUT_MS: positiveInteger.optional(),
  npm_package_version: z.string().optional(),
});
export type EnvironmentConfig = z.infer<typeof baseEnvSchema>;
const envSchema = baseEnvSchema.superRefine((value, ctx) => {
  if (value.NODE_ENV === 'production') {
    const placeholders: Array<[keyof EnvironmentConfig, string]> = [
      ['DATABASE_URL', 'postgres://localhost:5432/payd_test'],
      ['JWT_SECRET', 'dev-jwt-secret'],
      ['JWT_REFRESH_SECRET', 'dev-jwt-refresh-secret'],
    ];
    for (const [name, placeholder] of placeholders) {
      if (!value[name] || value[name] === placeholder) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: name + ' must be configured for production',
        });
      }
    }
  }
  if (
    value.TAX_COMPLIANCE_PROVIDER === 'external_compliance_api' &&
    !value.TAX_COMPLIANCE_API_BASE_URL
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['TAX_COMPLIANCE_API_BASE_URL'],
      message: 'required for external tax compliance',
    });
  }
});
export function parseEnvironment(input: NodeJS.ProcessEnv): EnvironmentConfig {
  return envSchema.parse(input);
}
export const config = parseEnvironment(process.env);

// Keep validated on-demand reads for test overrides and refreshable providers.
export function readEnv<K extends keyof EnvironmentConfig>(name: K): EnvironmentConfig[K] {
  const raw = process.env[name];
  return raw === undefined
    ? config[name]
    : (baseEnvSchema.shape[name].parse(raw) as EnvironmentConfig[K]);
}
// Independent schema-migration CLIs require an explicit URL, not test defaults.
export function readExplicitEnv(name: keyof EnvironmentConfig): string | undefined {
  return process.env[name];
}
// Dynamic Soroban contract deployment keys are registered by namespace.
export function listContractDeploymentEnv(): Array<[string, string | undefined]> {
  return Object.entries(process.env).filter(([key]) =>
    /^[A-Z][A-Z0-9_]*_(TESTNET|MAINNET)_CONTRACT_ID$/.test(key)
  );
}
export function readDynamicEnv(name: string): string | undefined {
  return /^[A-Z][A-Z0-9_]*_(TESTNET|MAINNET)_(VERSION|DEPLOYED_AT)$/.test(name)
    ? process.env[name]
    : undefined;
}
export const getThrottlingConfig = () => ({
  tpm: parseInt(readEnv('THROTTLING_TPM'), 10),
  maxQueueSize: parseInt(readEnv('THROTTLING_MAX_QUEUE_SIZE'), 10),
  refillIntervalMs: parseInt(readEnv('THROTTLING_REFILL_INTERVAL_MS'), 10),
});
export const getRateLimitConfig = () => ({
  auth: { windowMs: parseInt(readEnv('RATE_LIMIT_AUTH_WINDOW_MS'), 10), maxRequests: parseInt(readEnv('RATE_LIMIT_AUTH_MAX'), 10) },
  api: { windowMs: parseInt(readEnv('RATE_LIMIT_API_WINDOW_MS'), 10), maxRequests: parseInt(readEnv('RATE_LIMIT_API_MAX'), 10) },
  data: { windowMs: parseInt(readEnv('RATE_LIMIT_DATA_WINDOW_MS'), 10), maxRequests: parseInt(readEnv('RATE_LIMIT_DATA_MAX'), 10) },
});
// Deprecated safety switches remain always enabled.
export function isFeatureEnabled(_flag: string): boolean { return true; }
