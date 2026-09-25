# PayD Helm values

| File | Purpose |
|------|---------|
| `values.yaml` | Chart defaults (mid-size cluster) |
| `values-staging.yaml` | Staging overrides — 1 replica floor, debug logs, Stellar TESTNET |
| `values-production.yaml` | Production overrides — higher replicas/resources, MAINNET, stricter ingress |

## Install

```bash
# Staging
helm upgrade --install payd charts/payd -f charts/payd/values-staging.yaml \
  --set backend.secrets.DATABASE_URL="$DATABASE_URL" \
  --set backend.secrets.JWT_SECRET="$JWT_SECRET"

# Production
helm upgrade --install payd charts/payd -f charts/payd/values-production.yaml \
  --set backend.secrets.DATABASE_URL="$DATABASE_URL" \
  --set backend.secrets.JWT_SECRET="$JWT_SECRET"
```

## Key knobs

| Path | Description |
|------|-------------|
| `backend.replicaCount` / `frontend.replicaCount` | Static replicas when HPA is off |
| `backend.resources` / `frontend.resources` | requests/limits per env |
| `backend.autoscaling.*` | HPA min/max and CPU/memory targets |
| `backend.config.NODE_ENV` / `LOG_LEVEL` / `ENABLE_CACHING` / `CACHE_TTL` | Runtime feature toggles |
| `features.*` | Chart-level feature flags (staging enables debug endpoints) |
| `ingress.*` | Hosts, TLS secret, cert-manager issuer |
| `stellar.*` | Network, Horizon, Soroban RPC |
| `backend.secrets.*` | Supply via `--set` or an external secret manager — never commit real values |
