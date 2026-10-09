# Backend environment contract

All production backend runtime configuration is declared in `src/config/env.ts`,
validated through Zod at startup and accessed by typed `readEnv('KEY')`.
`src/config/index.ts` retains the prior nested interface for existing services.

Production refuses default/placeholder `DATABASE_URL`, `JWT_SECRET` and
`JWT_REFRESH_SECRET`. Invalid TCP ports, integer settings, and missing external
tax provider URLs fail before the listener starts. Keep production secrets
in the deployment environment, never in committed `.env` files.

Dynamic contract IDs are the exception to enumerated keys, handled by
`listContractDeploymentEnv()` and `readDynamicEnv()` within the central
config module. Standalone database CLIs still enforce an explicitly set
database URL; tests may set `process.env` as test fixtures.

Focused verification: `cd backend && npm run build` and
`npm test -- --runInBand src/config/__tests__/env.test.ts`.
