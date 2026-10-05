import { spawnSync } from 'node:child_process';

const required = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.log(`Skipping Sentry source-map upload; missing ${missing.join(', ')}.`);
  process.exit(0);
}

const cli = process.platform === 'win32' ? 'sentry-cli.exe' : 'sentry-cli';

function run(args) {
  const result = spawnSync(cli, args, {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(['sourcemaps', 'inject', 'dist']);
run([
  'sourcemaps',
  'upload',
  '--org',
  process.env.SENTRY_ORG,
  '--project',
  process.env.SENTRY_PROJECT,
  'dist',
]);
