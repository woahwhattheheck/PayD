# Contributing to PayD

Thanks for helping improve PayD — a Stellar-based cross-border payroll platform.

## Local development setup

### Prerequisites

- Node.js 22+
- npm
- Rust toolchain + `wasm32v1-none` target (Soroban contracts)
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli)
- Docker (optional; useful for Postgres/Redis)
- kubectl / Helm (only if you are changing Kubernetes manifests)

### Clone and install

```bash
git clone https://github.com/Protocol-Guild/PayD.git
cd PayD
npm install
```

### Environment

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

Fill in Stellar, database, Redis, and JWT values. Never commit real secrets.

### Frontend

```bash
cd frontend   # or from repo root via workspace scripts when configured
npm run dev
```

- `npm run build` — production build
- `npm run lint` / `npm run format` — lint and format
- `npm run test:e2e` — Playwright end-to-end tests

### Backend

```bash
cd backend
npm install
npm run dev
```

- `npm run build` / `npm start` — compile and run
- `npm test` — Jest unit tests
- `npm run lint` — ESLint
- `npm run db:migrate` — apply database migrations

### Contracts (Soroban)

Workspace crates live under `contracts/` (`bulk_payment`, `revenue_split`, `cross_asset_payment`, `vesting_escrow`, plus shared `common`).

```bash
# from repo root
cargo test
cargo build --release --target wasm32v1-none -p bulk_payment
```

Contract releases on `v*` tags are published by `.github/workflows/contract-release.yml`.

## Architecture overview

```
Organization UI (React/Vite)
        │
        ▼
   Backend API (Express)
        │
        ├── PostgreSQL / Redis
        └── Stellar network + Soroban contracts
                    │
                    ▼
              Local anchors / cash-out
```

| Area | Path | Notes |
| --- | --- | --- |
| Frontend | `frontend/` | React 19, Vite, Stellar wallets kit |
| Backend | `backend/` | Express API, payroll engine, SDS/Horizon |
| Contracts | `contracts/` | Soroban packages in the Cargo workspace |
| Kubernetes | `k8s/` | Kustomize base; secrets via External Secrets |
| Helm | `charts/payd/` | Chart for packaged installs |
| Terraform | `infrastructure/terraform/` | Includes AWS Secrets Manager module |

## Code style and standards

- Match existing TypeScript / Rust style in the files you touch.
- Prefer small, focused PRs with a clear problem statement.
- Do not commit secrets, private keys, or real `CHANGE_ME` replacements into tracked manifests.
- Kubernetes: production secrets come from External Secrets Operator (`k8s/base/external-secret.yaml`). See `k8s/README.md`.
- License for this repository is Apache-2.0 (see `LICENSE`).

## Testing guide

| Layer | Command | Expectation |
| --- | --- | --- |
| Backend unit | `cd backend && npm test` | Existing Jest suites pass |
| Frontend e2e | `cd frontend && npm run test:e2e` | Playwright suite green when UI touched |
| Contracts | `cargo test` (workspace) | Package tests for changed crates |
| Secrets hygiene | Prefer ESO / `kubectl create secret`; never paste live keys into git | `k8s/base/` must not gain plaintext Secret stringData |

Run the suites that cover your change before requesting review.

## Pull request process

1. Open an issue (or claim an existing labeled issue) describing the bug or feature.
2. Branch from `main` with a short, descriptive name.
3. Keep commits focused; write messages that explain *why*.
4. Open a PR against `main` that:
   - Links the issue (`Closes #123` when it fully resolves it)
   - Summarizes what changed and how to verify
   - Notes any follow-up or out-of-scope work
5. Address review feedback; do not force-push over review history unless asked.
6. A maintainer merges after CI and review pass.

### Review criteria

- Correctness and security (especially Stellar keys, auth, and payroll paths)
- Tests or a clear manual verification plan
- Docs updated when behavior or setup changes
- No unrelated refactors or license/badge noise

## Questions

Use GitHub Issues on this repository for design questions and bug reports. For deployment details, start with `docs/deployment.md` and `k8s/README.md`.
