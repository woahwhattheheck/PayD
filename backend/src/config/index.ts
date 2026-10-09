import { readEnv } from './env.js';

// Retain the application's existing nested config shape, from one Zod schema.
export const config = {
  port: Number.parseInt(readEnv('PORT'), 10),
  nodeEnv: readEnv('NODE_ENV'),
  stellar: {
    networkPassphrase: readEnv('STELLAR_NETWORK_PASSPHRASE'),
    horizonUrl: readEnv('STELLAR_HORIZON_URL'),
  },
  sds: {
    enabled: ['true', '1'].includes(readEnv('SDS_ENABLE')),
    apiKey: readEnv('SDS_API_KEY'),
    endpoint: readEnv('SDS_ENDPOINT'),
    timeout: Number.parseInt(readEnv('SDS_TIMEOUT'), 10),
    retryAttempts: Number.parseInt(readEnv('SDS_RETRY_ATTEMPTS'), 10),
    retryDelay: Number.parseInt(readEnv('SDS_RETRY_DELAY'), 10),
  },
  database: {
    url: readEnv('DATABASE_URL'),
    host: readEnv('DB_HOST'),
    port: Number.parseInt(readEnv('DB_PORT'), 10),
    user: readEnv('DB_USER'),
    password: readEnv('DB_PASSWORD'),
    name: readEnv('DB_NAME'),
  },
  cache: {
    enabled: ['true', '1'].includes(readEnv('ENABLE_CACHING')),
    ttl: Number.parseInt(readEnv('CACHE_TTL'), 10),
  },
  logging: { level: readEnv('LOG_LEVEL') },
};
export default config;
