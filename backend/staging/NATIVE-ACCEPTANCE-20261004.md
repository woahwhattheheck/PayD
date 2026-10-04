# Native staging acceptance — 2026-10-04

This receipt covers the staging work for issue #530 / PR #635 at product commit
`dbff07d69223bc699c3af03b2d0ba57dee82dc05`, tree
`c83c0cca26c10c8a9ca85a992dd7127ab3870492`. No application-source repair was needed
for this run. Later source changes require their own evidence.

[Execution run 37189968962](https://github.com/woahwhattheheck/PayD/actions/runs/37189968962),
job `111399914243`, completed successfully on October 4, 2026. The isolated
[executed workflow](https://github.com/woahwhattheheck/PayD/blob/11f97e3f8dbf914df4d4610d48138a6a727924cd/.github/workflows/payd635-native-staging.yml)
pins the exact product commit and contains the commands and generated disposable
configuration. It runs one staging job, not the repository's complete CI matrix.

## Environment and observed results

The standard Ubuntu 24.04 runner used Docker 28.0.4 and Compose 2.38.2. The actual
application container reported Node 20.20.2; the database reported native
PostgreSQL 15.19 on Linux x86-64. This was not PGlite or a mocked database.

| Check | Observed result |
| --- | --- |
| Actual Compose build and startup | Production API and migration images built; PostgreSQL and Redis became healthy; migration service exited 0; API `/health/live` succeeded. |
| Repeated bootstrap | A second `migrate` run exited 0. Organization, employee, transaction, migration-ledger and seed-marker counts stayed `1 / 5 / 5 / 39 / 1`. |
| Production-configured anonymous access | `/api/employees` and `/api/admin` each returned HTTP 401 from the running staging API. |
| Native SQL acceptance | Restricted application login, no-context denial, both tenant scopes, Promise/callback queries, explicit commit/rollback, rejected foreign insert, failed-transaction cleanup and stale-lease rejection passed. |
| Native HTTP acceptance | Existing employee services returned 5 own-tenant rows and 1 second-tenant row. Conflicting organization header and path returned 403; permitted employee search returned 200. |

The SQL/HTTP row above is the existing `tests/tenant-rls-postgres.mjs`, executed
once against the native Compose database and the built production image. The
script sets `NODE_ENV=test` for its separate loopback HTTP process and forces
pool capacity to one to exercise connection reuse. The anonymous-access checks
instead target the normally started, production-configured staging API. These
are distinct observations, not a claim that the test process used every
production runtime setting.

## Retained raw evidence

The original 13-member Actions artifact is retained byte-for-byte in Git, so its
contents do not depend on the short-lived Actions artifact download:

- [Raw logs, versions, source identity and seed counts](https://github.com/woahwhattheheck/PayD/blob/4c3e4b7895e86b287b4a3998a47482af7dd70cec/evidence/payd635-native-staging-20261004.zip)
- [Machine-readable receipt and member SHA-256 hashes](https://github.com/woahwhattheheck/PayD/blob/4c3e4b7895e86b287b4a3998a47482af7dd70cec/evidence/native-acceptance.json)

Archive: **12,395 bytes**; SHA-256:
`1a56f81b00dad1e1d1562c644669915b1704f8230fdac7f406a7e5c3d7bed4e4`.
The archival step verified the original ZIP digest, size, CRCs and source IDs;
it did not rerun the application or acceptance checks.

## Boundaries

All records and credentials were disposable synthetic fixtures. SDS was disabled
and Horizon/Soroban URLs pointed to loopback; no live-chain transaction was part
of the run. API liveness and local PostgreSQL/Redis startup do not establish
successful external-Horizon readiness. This run does not claim a full Jest
suite, full-source typecheck, scheduler/contract acceptance, load benchmark or
multi-client concurrency result. The general operational and migration-volume
instructions remain in `README.md`.
