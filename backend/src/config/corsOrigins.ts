import { config } from './env.js';

const localhostDevOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

// Both the HTTP API and Socket.IO must use the same exact-origin policy.
export const allowedCorsOrigins = Array.from(
  new Set([
    ...(config.CORS_ORIGIN ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
    ...(config.NODE_ENV === 'development' ? localhostDevOrigins : []),
  ])
);
