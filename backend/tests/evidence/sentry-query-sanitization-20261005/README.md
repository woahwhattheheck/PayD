# PayD #721 Sentry query sanitization evidence

Source successor `6102b3bc44775889785966bed058d9e98a4705bb`, tree `251527e3eb4066714e560a8c386f06d03d9c4121`, sole parent `3e71b117490ed0d381734d31be4ed4cc0a62e2eb`. This separate validation branch preserves the actual logs and recording-only SDK evidence. Product PR #721 changes only its existing sanitizer and test file. The released original GF-PAYD540 source/publication carrier remains preserved.

The real locked Sentry 10.76.0 event retained query details in its request URL and Referer header on the frozen source. Its SDK already filtered the dummy secretKey value; no raw secret-key exposure is claimed. The repair strips query/fragment suffixes and drops unexpected non-string URL/referrer values, while preserving safe origin/path, capture tags/context, user ID, method, and debug headers.

Same final focused tests on frozen source: 4 failed, 2 passed. Final candidate: 6 passed, zero failed. Candidate scoped strict types passed; faithful existing ESLint rules passed with zero errors and seven existing explicit-any warnings. Existing CommonJS `.eslintrc.js` cannot load directly under the backend's `type: module`; the lint command copied its bytes to an untracked `.cjs` name without changing rules. Whole backend types on the frozen source fail with 15 existing tenantConfigService.ts syntax errors, byte-identical to sponsor main. No whole final-candidate build or full suite is claimed.

Reproduce the focused check from the pinned source checkout:

```sh
cd backend
npm ci --ignore-scripts --no-audit --no-fund
NODE_OPTIONS=--experimental-vm-modules npm test -- --runInBand --runTestsByPath src/observability/__tests__/sentry.test.ts
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --module NodeNext --moduleResolution NodeNext --target es2022 --esModuleInterop --types node,jest,passport src/instrument.ts src/observability/sentry.ts src/observability/__tests__/sentry.test.ts src/types/auth.ts
cp .eslintrc.js .sentry-validation.eslintrc.cjs
./node_modules/.bin/eslint --no-eslintrc --config .sentry-validation.eslintrc.cjs src/instrument.ts src/observability/sentry.ts src/observability/__tests__/sentry.test.ts src/app.ts src/index.ts
```

To reproduce the differential, overlay only the final test file onto a detached checkout of the frozen parent, using the same locked dependency installation. The preserved final-red and final-green logs/results record the actual executions; earlier four-case checks remain separately named historical records. The standalone probe preserves its original scratch paths as execution provenance; the committed Jest test above supplies the portable SDK regression.

No live Sentry delivery, credentials, Express server, deliberately triggered process crash, account-side alert rule, hosted CI pass, deployment, reward or payment was involved. Recording transport, normalized request fixtures and the actual SDK capture path define this evidence's scope.
