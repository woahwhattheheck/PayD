# Contributing to PayD

Thanks for helping improve PayD — a Stellar-based cross-border payroll platform.
This guide covers local setup, architecture, coding standards, testing, and the
pull request process.

## Table of contents

1. [Code of conduct](#code-of-conduct)
2. [Architecture overview](#architecture-overview)
3. [Prerequisites](#prerequisites)
4. [Local development setup](#local-development-setup)
5. [Code style and standards](#code-style-and-standards)
6. [Testing guide](#testing-guide)
7. [Pull request process](#pull-request-process)
8. [Where to get help](#where-to-get-help)

## Code of conduct

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
Be respectful, assume good intent, and keep discussions focused on the work.

## Architecture overview

PayD has three main layers that work together:

```
┌────────────────────┐     HTTPS/JSON      ┌────────────────────┐
│  Frontend (React)  │◄───────────────────►│  Backend (Express) │
│  Vite + TypeScript │                     │  Node.js + PG/Redis│
└─────────┬──────────┘                     └─────────┬──────────┘
          │ Stellar Wallets Kit                       │ Stellar SDK / Soroban RPC
          ▼                                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Stellar Network                              │
│  Horizon · Soroban RPC · Anchors (cash-out) · Org assets         │
└─────────────────────────────────────────────────────────────────┘
          ▲
          │ Rust / Soroban
┌─────────┴──────────┐
│  Contracts (Rust)  │  bulk_payment · vesting_escrow · revenue_split · …
└────────────────────┘
```

| Layer | Role |
| ----- | ---- |
| **Frontend** (`frontend/`, root Vite app) | Employer dashboard, employee portal, wallet connect |
| **Backend** (`backend/`) | Auth, payroll, employees, schedules, audits, webhooks |
| **Contracts** (`contracts/`) | Soroban programs for payments, vesting, splits |
| **Infra** | PostgreSQL for persistence, Redis for cache/rate limits |

High-level request flow:

1. Employer or employee authenticates (wallet / OAuth / 2FA where required).
2. Frontend calls `/api/...` on the Express backend.
3. Backend validates input, enforces tenant isolation and rate limits, then
   reads/writes Postgres and/or submits Stellar transactions.
4. Contract events and payment results are indexed for audit and dashboards.

## Prerequisites

Install these before cloning:

| Tool | Notes |
| ---- | ----- |
| **Node.js** 22+ | Frontend and backend |
| **npm** (or yarn/pnpm) | Package management |
| **Docker** (optional) | Local Postgres / Redis |
| **Rust** + **Stellar CLI/scaffold tooling** | Root scaffold workflow or contract work |
| **Git** | Branching and PRs |

## Local development setup

### 1. Clone and install

```bash
git clone https://github.com/Protocol-Guild/PayD.git
cd PayD
```

Install root and frontend dependencies separately (the root workspace does not include `frontend/`):

```bash
npm install
cd frontend && npm install && cd ..
```

Install backend dependencies:

```bash
cd backend
npm install
cd ..
```

### 2. Environment configuration

Copy the example env files and edit secrets for your machine:

```bash
cp .env.example .env
cp .env.example frontend/.env
cp backend/.env.example backend/.env
```

The root `.env` configures the scaffold workflow. Vite launched from `frontend/`
reads `frontend/.env`; configure its `PUBLIC_STELLAR_*` values for your network.
The [frontend Vite config](./frontend/vite.config.ts) uses Vite's default
[environment directory](https://vite.dev/config/shared-options#envdir).

In `backend/.env`, keep one `PORT=3000` assignment and remove the duplicate `PORT`
entries copied from the example. This local setting matches the frontend's
`/api` proxy at `http://localhost:3000`. If you choose another API port, update
that proxy target and the health-check URL together.

Important backend variables (see `backend/.env.example`):

- `PORT` — use `3000` for the local setup above; the
  [backend config](./backend/src/config/index.ts) falls back to `3001` when unset
- `DATABASE_URL` / `DB_*` — Postgres connection
- `STELLAR_HORIZON_URL` / `STELLAR_NETWORK_PASSPHRASE` — network target
- `SDS_*` — optional Stellar Data Service settings
- `NODE_ENV` — `development` for verbose errors; never leak stacks in production

### 3. Database

For a new local development database, replace all `DATABASE_URL` and `DB_*`
assignments in `backend/.env` with this single matching block. Do not append it
to the copied example: that file contains two different `DATABASE_URL` entries,
and neither uses the credentials for the database below.

```dotenv
DATABASE_URL=postgresql://payd_user:payd_password@localhost:5432/payd_db
DB_HOST=localhost
DB_PORT=5432
DB_USER=payd_user
DB_PASSWORD=payd_password
DB_NAME=payd_db
```

These are local development credentials, not production settings. When using an
existing database, substitute its actual connection details consistently in
both the URL and the individual fields; do not remove existing data to follow
this example.

Create the matching database using Docker:

```bash
docker run --name payd-postgres \
  -e POSTGRES_USER=payd_user \
  -e POSTGRES_PASSWORD=payd_password \
  -e POSTGRES_DB=payd_db \
  -p 5432:5432 -d postgres:15
```

Wait until PostgreSQL is ready before running migrations:

```bash
docker exec payd-postgres pg_isready -U payd_user -d payd_db
# Continue when this reports "accepting connections".
```

Then, from the repository root, run migrations from `backend/`:

```bash
cd backend
npm run db:migrate
npm run db:verify-schema
```

### 4. Run the apps

Use separate terminals for the backend and frontend. Start each command block
below from the repository root.

**Backend** (API on port 3000 with the local configuration above):

```bash
cd backend
npm run dev
```

**Frontend** (standalone Vite project):

```bash
cd frontend
npm run dev
```

This invokes `vite` via [frontend/package.json](./frontend/package.json).

**Root scaffold workflow** (Stellar contract watcher and Vite):

```bash
npm run dev
```

The root [package.json](./package.json) maps `dev` to `npm start`, which runs
`stellar scaffold watch --build-clients` and `vite` concurrently. Install the
Rust and Stellar CLI/scaffold tooling before using this workflow.

**Contracts** (optional):

```bash
# build workspace crates
cargo build --release
# or use Stellar CLI / scaffold workflows as documented in contract READMEs
```

Health check for the local configuration above: `GET http://localhost:3000/health`

## Code style and standards

- **Language**: TypeScript for frontend and backend; Rust for Soroban contracts.
- **Formatting**: Prettier (root `npm run format`). Do not hand-fight style.
- **Linting**: ESLint (`npm run lint` in root/frontend; `npm run lint` in backend).
- **Modules**: Backend uses ESM (`"type": "module"`). Prefer explicit `.js`
  extensions in relative TypeScript imports to match existing files.
- **Errors**: Match the existing backend error response shape. Do not return raw
  database or stack messages to clients outside development.
- **Security**: Never commit secrets. Sanitize logs (passwords, tokens, keys).
  Preserve tenant isolation middleware on multi-tenant routes.
- **Commits**: Prefer [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`). Reference issues with
  `Closes #N` when the change fully addresses them.
- **License**: Project license is **Apache-2.0** (see `LICENSE`). Keep that
  consistent in docs and badges.

## Testing guide

### Backend

```bash
cd backend
npm test                          # all Jest unit/integration tests
npm test -- --coverage            # coverage report
npm test -- --testPathPatterns=X  # subset by path pattern
```

Tests live next to code under `backend/src/**/__tests__/**/*.test.ts`.
Mock external I/O (DB, Redis, Horizon) unless you are writing an explicit
integration test.

Additional helpers:

- `npm run db:migrate:dry-run` — validate migrations without applying
- `backend/test-*.sh` — manual/API smoke scripts when documented

### Frontend

Start in a new terminal at the repository root, after installing the frontend
dependencies described above:

```bash
cd frontend
npm run lint
npm run build
npx playwright install chromium firefox
npm run test:e2e            # Playwright
npm run test:e2e:ui         # interactive Playwright
```

Install the configured Chromium and Firefox browsers before the first E2E run,
and repeat the install command after updating Playwright. Its browser binaries
are tied to the installed Playwright version.

On Linux hosts that also need browser system dependencies, use
`npx playwright install --with-deps chromium firefox` from `frontend/` instead
of the browser-only install command. This is the same setup used by the
[E2E workflow](./.github/workflows/e2e.yml).

Playwright starts the Vite dev server automatically. See the
[frontend E2E guide](./frontend/e2e/README.md) for headed runs and reports, and
the [Playwright browser guide](https://playwright.dev/docs/browsers) for
installation details.

### Contracts

```bash
cargo test
# follow per-crate docs under contracts/<name>/
```

### CI expectations

GitHub Actions (see `.github/workflows/`) run checks according to event and
changed paths. Contract releases run on version tags, not every PR. Run the
focused checks relevant to your change before requesting review.

## Pull request process

1. **Find or open an issue** describing the bug/feature. Comment if you intend
   to work on it so others do not duplicate effort.
2. **Branch from `main`** with a descriptive name, e.g. `fix/payroll-timeout`
   or `feat/error-middleware`.
3. **Keep the diff focused**. One concern per PR. Avoid drive-by refactors
   unrelated to the issue.
4. **Add or update tests** for behavioral changes. Document env vars and
   migrations when you introduce them.
5. **Write a clear PR description**:
   - What changed and why
   - How you tested it
   - Linked issue (`Closes #123`)
6. **Self-review** the diff: no secrets, no debug leftovers, consistent style.
7. **Request review**. Address feedback with follow-up commits (or a squash if
   maintainers prefer).
8. **Do not force-push** to shared review branches unless a maintainer asks.

### Review criteria

Maintainers look for:

- Correctness against the issue acceptance criteria
- Tests that would fail without the change
- Clear error handling and no sensitive data in responses/logs
- Readable structure matching neighboring code
- Docs updated when user-facing or contributor-facing behavior changes

## Where to get help

- Project overview and feature list: [README.md](./README.md)
- Backend SDS / search / multi-tenant docs: files under `backend/`
- Contract design notes: `contracts/` and related `*_ARCHITECTURE.md` docs
- Open an issue for bugs, design questions, or setup blockers

Welcome aboard — small, well-tested contributions are preferred over large
unfocused ones.
