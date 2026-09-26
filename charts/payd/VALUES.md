# PayD Helm values

| File | Purpose |
|------|---------|
| `values.yaml` | Chart defaults |
| `values-staging.yaml` | Staging overrides — 1 replica floor, debug logs, Stellar TESTNET |
| `values-production.yaml` | Production overrides — higher replicas/resources, MAINNET |

## Install

Set the real ingress hosts and CORS origin for your domains. Keep credentials in private files outside this repository and pass their paths, not their values, to Helm:

```bash
# Staging
helm upgrade --install payd charts/payd -f charts/payd/values-staging.yaml \
  --set-file backend.secrets.DATABASE_URL=/secure/path/staging-database-url \
  --set-file backend.secrets.JWT_SECRET=/secure/path/staging-jwt-secret

# Production
helm upgrade --install payd charts/payd -f charts/payd/values-production.yaml \
  --set-file backend.secrets.DATABASE_URL=/secure/path/production-database-url \
  --set-file backend.secrets.JWT_SECRET=/secure/path/production-jwt-secret
```

The chart renders `backend.secrets.*` into a Kubernetes Secret, and Helm stores release values. Restrict access to the release and Secret accordingly. Supply the other secret keys your deployment uses through the same private path or your cluster's secret-management process.

## Key knobs

| Path | Description |
|------|-------------|
| `backend.replicaCount` / `frontend.replicaCount` | Static replicas when HPA is off |
| `backend.resources` / `frontend.resources` | Requests and limits per environment |
| `backend.autoscaling.*` | HPA min/max and CPU/memory targets |
| `backend.config.NODE_ENV` | Must be `development`, `production`, or `test`; staging uses `production` runtime behavior |
| `backend.config.LOG_LEVEL` / `ENABLE_CACHING` / `CACHE_TTL` / `SDS_ENABLE` / `RATE_LIMIT_API_MAX` | Environment controls consumed by the backend |
| `ingress.*` | Replace placeholder hosts, TLS secret, and cert-manager issuer with deployment values |
| `stellar.*` | Network, Horizon, Soroban RPC |
| `backend.secrets.*` | Secret values rendered into the backend Kubernetes Secret |

Only keys under `backend.config` are rendered as backend environment variables by this chart. The previously documented top-level `features.*` keys were not consumed by any template.
