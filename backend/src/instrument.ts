import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { sanitizeSentryEvent } from './observability/sentry.js';

const dsn = process.env.SENTRY_DSN?.trim();

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  release: process.env.SENTRY_RELEASE || undefined,
  sendDefaultPii: false,
  beforeSend: sanitizeSentryEvent,
});
