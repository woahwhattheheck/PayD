# Staging database and API

Run the commands below from the repository root. Copy
`backend/.env.staging.example` to `backend/.env.staging` and set independent
database-owner, application, JWT, and JWT-refresh secrets. The application and
owner database usernames must differ. Every Compose command uses the same file:

```sh
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml up --build
```

The API is available on port 3101, PostgreSQL on 5433, and Redis on 6380. These
services have their own named volumes and network. Stellar endpoints default to
testnet; staging does not inherit a production `.env` file.

The PostgreSQL and Redis host ports bind to `127.0.0.1` only. Connect from the
Docker host using `127.0.0.1:5433` and `127.0.0.1:6380`, or run database tools with
`docker compose ... exec` on the service. Remote administration should use an SSH
tunnel rather than exposing these ports: Redis has no application authentication,
and publishing its port must not bypass the API's access controls. Container
connections still use `postgres:5432` and `redis:6379` on the staging network;
the authenticated API's host publication on port 3101 is unchanged.

## Startup and repeated runs

PostgreSQL becomes healthy only when its normal TCP listener is available. The
`migrate` service then applies **every** SQL migration in filename order through
the same migration core as `npm --prefix backend run db:migrate`. It records each
file's checksum and SQL changes in one transaction, serializes simultaneous
migration runs with an advisory lock, and rejects changed applied files before
executing pending SQL.
Migration SQL is included in both the migration image and the production image.

After migration, one transaction loads `src/db/seed.sql`, records its `seed-v1`
marker in the database, and provisions the application role. A repeated bootstrap
skips recorded migrations and the seed, so it does not create another organization
or duplicate tax rules. New migrations remain runnable against a retained volume.

The API waits for `migrate` to exit successfully and Redis to become healthy.
A migration or seed error exits nonzero and prevents API startup. Inspect or rerun
the database step independently:

```sh
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml logs migrate
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml up --build migrate
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml run --rm migrate
```

## Effective application permissions

Only PostgreSQL and `migrate` receive `STAGING_DB_ADMIN_PASSWORD`. The API receives
the separate `STAGING_DB_USER`/`STAGING_DB_PASSWORD` pair; its entrypoint constructs
the connection URL with URL escaping, including passwords containing `@`, `:` or
`/`. It does not inherit the entire shared environment file.

The application role has no superuser, database creation, role creation,
replication, RLS-bypass, or table-ownership privileges. It receives DML access and
sequence usage, while migration and seed ledgers remain owner-only. Existing
privileged roles are rejected rather than silently repurposed. PostgreSQL 15
views use `security_invoker` so the application cannot bypass table RLS through
an owner-created view.

Bootstrap refuses a role that owns a schema and refuses to add synthetic seed
data to an already populated database without its seed marker. Use an independent
Compose project for a fresh staging dataset; existing data is preserved.

The tenant policies use `app.current_tenant_id`. JWT authentication establishes
the signed user's organization and user ID in the asynchronous request context.
The shared database pool applies both values with parameterized `set_config`
calls on every checkout, so ordinary service queries and explicit service
transactions use the same scope. Conflicting organization headers or URL
parameters return 403. A connection with no tenant scope sees no employee or
transaction rows.

The pool rolls back unfinished transactions and clears both session values
before returning a connection for reuse. Initialization or cleanup failures
discard the connection. Explicit service `BEGIN`, `COMMIT`, and `ROLLBACK`
remain under service control. The legacy request `dbClient` acquires its
connection only when used, so an unused request connection cannot exhaust the
pool while service queries wait. Environment flags alone do not grant access.

Employee operations and quota counts also open a transaction with a local tenant
setting on the same client. This keeps direct service calls scoped when no HTTP
request context exists. Bulk imports retain their existing transaction and set
its tenant before inserting rows. Successful operations commit before responding;
failures roll back, and a connection with failed rollback is discarded.

All `/api/admin` routes require an access token and the `ADMIN` role before the
existing justification and audit requirements. A reason header alone grants no
access, and a two-factor challenge token cannot be used as an access token.

Build the API and run the pool lifecycle checks from the repository root:

```sh
(cd backend && npm run build && node --test tests/tenant-pool.test.mjs)
```

Run the SQL and HTTP acceptance command from the backend directory as well:

```sh
(cd backend && node tests/tenant-rls-postgres.mjs)
```

The subshells leave the working directory at the repository root for subsequent
Compose commands. The SQL and HTTP command requires `RLS_TEST_DATABASE_URL` for a
disposable database owner's connection, plus `STAGING_DB_USER` and
`STAGING_DB_PASSWORD` for a distinct application role. It initializes that
database and creates dedicated regression fixtures. Native mode connects using
the application login. Its explicit `--pglite` mode is only for a local WASM
harness and does not establish native PostgreSQL authentication or concurrency.

## Build and verification boundaries

`npm --prefix backend run build` compiles production sources with the existing
strict checks and refuses to emit on a compiler error. Tests remain available
through `npm --prefix backend test`; `npm --prefix backend run typecheck` checks
the complete source and test graph without emitting. The complete typecheck
still exposes inherited test-source diagnostics and must
not be reported as passing merely because the production build succeeds.

The image includes SQL migrations, the staging entrypoint, and `.well-known`
assets. Local `.env` files are excluded from the Docker context.

`/health/live` reports that the API process can answer. `/health` separately
checks PostgreSQL, Redis, and Horizon and returns 503 when a configured dependency
fails. Local SQL or HTTP verification does not establish a successful Docker
Compose deployment, native PostgreSQL login/concurrency, or a reachable external
Horizon service; run the complete stack before reporting those deployment facts.

## Volumes created by the previous partial staging stack

The old stack applied only migrations 001, 003, and 009 through PostgreSQL init
files and did not record a migration ledger. Do not delete such a volume or mark
all migrations applied. The new runner stops with a clear error when it finds
application tables without a ledger, preserving all existing data.

Keep the old database-owner credentials when accessing that volume. Back it up
and reconcile its actually applied migration filenames/checksums before using
the canonical migration chain. For an independent fresh staging database, choose
a new Compose project name with `-p`; the original project's volume is retained.
Changing `POSTGRES_USER` or its password in an env file does not modify roles in
an already initialized PostgreSQL data directory.

The added `015a` migration composes the two existing `contract_events` layouts
before 016 creates its indexes. Both event producers retain their own identifier
columns and uniqueness keys; existing event rows are retained, and unknown tenant
metadata is not assigned to a guessed organization.
