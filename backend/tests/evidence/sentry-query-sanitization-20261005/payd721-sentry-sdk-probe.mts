import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as Sentry from '/workspace/scratch/ea8baa184658/payd721-sentry-validation/backend/node_modules/@sentry/node/build/esm/index.js';
import { httpRequestToRequestData } from '/workspace/scratch/ea8baa184658/payd721-sentry-validation/backend/node_modules/@sentry/core/build/esm/index.js';
import { captureRequestError, sanitizeSentryEvent } from '/workspace/scratch/ea8baa184658/payd721-sentry-validation/backend/src/observability/sentry.ts';

const events: any[] = [];
const req: any = {
  requestId: 'probe-request-123', method: 'GET', baseUrl: '/api/payroll',
  route: { path: '/employees/:employeeId' }, path: '/employees/42',
  url: '/api/payroll/employees/42?payrollNote=DUMMY_PRIVATE_QUERY&secretKey=DUMMY_SECRET_KEY',
  protocol: 'https',
  user: { id: 17, email: 'dummy-private@example.invalid' },
  headers: { host: 'payd.example.invalid', authorization: 'Bearer DUMMY_AUTH', cookie: 'session=DUMMY_COOKIE', referer: 'https://payd.example.invalid/dashboard?payrollNote=DUMMY_REFERER_QUERY#DUMMY_FRAGMENT' },
  body: { password: 'DUMMY_BODY_PASSWORD' },
};
Sentry.init({
  dsn: 'https://0123456789abcdef0123456789abcdef@sentry.example.invalid/1', enabled: true,
  sendDefaultPii: false, beforeSend: sanitizeSentryEvent,
  transport: () => ({
    send(envelope: any) {
      for (const [header, item] of envelope[1]) if (header.type === 'event') events.push(item);
      return Promise.resolve({ statusCode: 200 });
    },
    flush: async () => true,
  }),
});
Sentry.withIsolationScope((scope) => {
  scope.setSDKProcessingMetadata({ normalizedRequest: httpRequestToRequestData(req) });
  captureRequestError(new Error('dummy controlled capture failure'), req);
});
await Sentry.flush(2000);
const event = events[0];
const serialized = JSON.stringify(event) || '';
const report = {
  sourceBase: '3e71b117490ed0d381734d31be4ed4cc0a62e2eb',
  productionSourceSha256: createHash('sha256').update(fs.readFileSync('/workspace/scratch/ea8baa184658/payd721-sentry-validation/backend/src/observability/sentry.ts')).digest('hex'),
  sdkVersion: Sentry.SDK_VERSION,
  recordingTransportOnly: true,
  realExpressExecution: false,
  actualSentryDelivery: false,
  eventCount: events.length,
  tags: event?.tags, user: event?.user, context: event?.contexts?.payd_request,
  request: event?.request,
  queryStringAbsent: event?.request?.query_string === undefined,
  requestBodyAbsent: event?.request?.data === undefined,
  credentialHeadersAbsent: event?.request?.headers?.authorization === undefined && event?.request?.headers?.cookie === undefined,
  privateQueryPresent: serialized.includes('DUMMY_PRIVATE_QUERY'),
  referrerQueryPresent: serialized.includes('DUMMY_REFERER_QUERY'),
  fragmentPresent: serialized.includes('DUMMY_FRAGMENT'),
  rawSecretKeyPresent: serialized.includes('DUMMY_SECRET_KEY'),
  authPresent: serialized.includes('DUMMY_AUTH'),
  bodyPresent: serialized.includes('DUMMY_BODY_PASSWORD'),
};
fs.writeFileSync('/tmp/payd721-sentry-sdk-probe.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
await Sentry.close(2000);
if (events.length !== 1) process.exitCode = 2;
else if (report.privateQueryPresent || report.referrerQueryPresent || report.fragmentPresent) process.exitCode = 1;
