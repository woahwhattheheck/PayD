# PayD Helm values

Helm merges [values.yaml](values.yaml) with the selected environment file. The
tables below describe the values and their actual template consumers. The image
names, ingress hosts and service dependencies in these files are examples that
must be configured for the deployment.

## Environment presets

| Setting | Defaults | Staging | Production |
|---|---|---|---|
| Override file | none | `values-staging.yaml` | `values-production.yaml` |
| Backend/frontend image tag | `latest` | `staging` | `stable` |
| Backend HPA minimum / maximum | 2 / 10 | 1 / 4 | 3 / 20 |
| Backend CPU request / limit | 250m / 500m | 200m / 500m | 500m / 1000m |
| Backend memory request / limit | 256Mi / 512Mi | 256Mi / 512Mi | 512Mi / 1Gi |
| Frontend replicas | 2 | 1 | 3 |
| Frontend CPU request / limit | 100m / 200m | 100m / 250m | 200m / 400m |
| Frontend memory request / limit | 128Mi / 256Mi | 128Mi / 256Mi | 256Mi / 512Mi |
| Backend `NODE_ENV` | `production` | `production` | `production` |
| Backend log level / cache TTL | info / 3600 | debug / 600 | warn / 7200 |
| Backend Stellar endpoints | TESTNET | TESTNET | MAINNET |

The backend deployment omits `spec.replicas` while HPA is enabled; the HPA
minimum controls its replica floor. `backend.replicaCount` applies only when
autoscaling is disabled. The frontend always uses `frontend.replicaCount`;
this chart has no frontend HPA. These are configuration presets, not measured
capacity or latency guarantees.

All three presets use the production backend runtime and therefore require a
separate refresh-signing key. Backend MAINNET endpoints in the production
preset do not change the frontend image's browser configuration; see
[Frontend image configuration](#frontend-image-configuration).

## Install

Set the real ingress hosts and CORS origin for your domains. Keep credentials
in private files outside this repository and pass their paths, not their values,
to Helm. Files used with `--set-file` are read literally, so avoid an unintended
trailing newline in a credential.

```bash
# Staging
helm upgrade --install payd charts/payd -f charts/payd/values-staging.yaml \
  --set-file backend.secrets.DATABASE_URL=/secure/path/staging-database-url \
  --set-file backend.secrets.JWT_SECRET=/secure/path/staging-jwt-secret \
  --set-file backend.secrets.JWT_REFRESH_SECRET=/secure/path/staging-jwt-refresh-secret

# Production
helm upgrade --install payd charts/payd -f charts/payd/values-production.yaml \
  --set-file backend.secrets.DATABASE_URL=/secure/path/production-database-url \
  --set-file backend.secrets.JWT_SECRET=/secure/path/production-jwt-secret \
  --set-file backend.secrets.JWT_REFRESH_SECRET=/secure/path/production-jwt-refresh-secret
```

The chart creates a Kubernetes Secret, and Helm stores release values. Restrict
access to the release and Secret accordingly. Supply the other named secret
keys needed by the deployment through the same private-file mechanism. This
chart does not create a database, Redis instance, cert-manager issuer or
ExternalSecret, and it has no `existingSecret` selector.

Use a separate `JWT_REFRESH_SECRET` for refresh-token signing. It is required
whenever `backend.config.NODE_ENV` is `production`, including staging and the
chart defaults. Helm template rendering stops when it is missing or empty.
Development and test configurations may omit it to retain the backend's local
default; a supplied value is always passed through.

## Values reference

### Naming and images

| Path | Consumer and behavior |
|---|---|
| `nameOverride` | Optional chart-name override in resource labels and generated names. |
| `fullnameOverride` | Optional full resource-name prefix; otherwise names derive from the Helm release and chart name. |
| `global.imageRegistry` | Prepended directly to both image repository strings. Include the separating slash when a registry prefix is used. |
| `global.imagePullSecrets` | Kubernetes image-pull Secret references copied into both pod specifications, for example a list of `name` mappings. |
| `backend.enabled` | Creates the backend Secret, ConfigMap, Service and Deployment, and its HPA when enabled. |
| `frontend.enabled` | Creates the frontend Service and Deployment. |
| `backend.image.repository`, `frontend.image.repository` | Image repository names. The chart does not build or publish these images. |
| `backend.image.tag`, `frontend.image.tag` | Tags appended after the repository name. |
| `backend.image.pullPolicy`, `frontend.image.pullPolicy` | Kubernetes container image-pull policies. |

When disabling a component, update `ingress.hosts` as well; ingress rules are
rendered from their own values and are not removed based on component flags.

### Replicas, resources, services and probes

| Path | Consumer and behavior |
|---|---|
| `backend.replicaCount` | Backend Deployment replicas when `backend.autoscaling.enabled` is false. |
| `frontend.replicaCount` | Frontend Deployment replicas. |
| `backend.resources.requests.cpu`, `backend.resources.requests.memory` | Backend pod resource requests, also used as the denominator for HPA utilization targets. |
| `backend.resources.limits.cpu`, `backend.resources.limits.memory` | Backend container resource limits. |
| `frontend.resources.requests.cpu`, `frontend.resources.requests.memory` | Frontend pod resource requests. |
| `frontend.resources.limits.cpu`, `frontend.resources.limits.memory` | Frontend container resource limits. |
| `backend.autoscaling.enabled` | Renders an `autoscaling/v2` HPA and omits fixed backend replicas. |
| `backend.autoscaling.minReplicas`, `backend.autoscaling.maxReplicas` | Backend HPA bounds. |
| `backend.autoscaling.targetCPUUtilizationPercentage` | CPU utilization target; a zero or omitted target is not rendered. |
| `backend.autoscaling.targetMemoryUtilizationPercentage` | Memory utilization target; a zero or omitted target is not rendered. Keep at least one metric configured when HPA is enabled. |
| `backend.service.type`, `frontend.service.type` | Kubernetes Service types. |
| `backend.service.port` | Backend Service port and container's named `http` port. Keep `backend.config.PORT` and ingress backend ports consistent; default probes use the named `http` port. |
| `frontend.service.port` | Frontend Service port; it targets the container's fixed named `http` port 80. |
| `backend.healthCheck.startupProbe` | Startup probe mapping; default checks `/health/live`, with up to 300 seconds for application startup. Set to `null` to omit it. |
| `backend.healthCheck.livenessProbe` | Complete probe mapping copied to the backend container. |
| `backend.healthCheck.readinessProbe` | Complete probe mapping copied to the backend container. |

All three backend probe mappings are rendered as configured. Startup and
liveness default to `/health/live`, the backend's dependency-independent process
check. Readiness stays on `/health`, which checks PostgreSQL, Redis and Horizon.
A dependency outage can therefore remove a ready endpoint without making that
same dependency failure trigger the routine liveness restart policy. Startup
allows up to 300 seconds (60 failures at 5-second intervals) before the normal
liveness/readiness probes take over; this is a configured allowance, not a
measured startup duration.

Default HTTP probes use the container's named `http` port, which follows
`backend.service.port`. Keep `backend.config.PORT` and ingress ports aligned
when changing that port. Each mapping supports the Kubernetes probe fields;
Helm merges environment overrides with defaults. To switch a probe to another
handler such as `exec`, explicitly set its inherited `httpGet` to `null`.
Setting the entire startup mapping to `null` omits the startup probe. The
frontend template fixes its probes to `/` on its named port 80 and does not
expose a corresponding values mapping.

### Backend environment and secrets

The backend pod template includes deterministic checksums of its rendered
ConfigMap and Secret. A chart-managed configuration or key change therefore
changes the pod template on `helm upgrade`, allowing the Deployment's normal
rolling-update mechanism to replace pods and load the new environment.
Identical rendered inputs keep both checksums stable; no random restart token
is used. Direct out-of-band edits to a live ConfigMap or Secret are not watched
by Helm: reconcile them through the release or arrange an explicit restart.
Checksums do not replace secret access control or secure credential generation.

Every entry under `backend.config` is quoted into the backend ConfigMap, which
the Deployment imports through `envFrom`. Keep ordinary controls here and
secret material in the named Secret entries.

| Path | Meaning |
|---|---|
| `backend.config.PORT` | Application listener port; keep it aligned with the backend service and probes. |
| `backend.config.NODE_ENV` | Backend runtime mode: `development`, `production` or `test`. Staging intentionally uses `production`. |
| `backend.config.DB_HOST`, `backend.config.DB_PORT`, `backend.config.DB_NAME` | Database connection fields supplied to the backend environment. Configure them consistently with the selected database and connection URL. |
| `backend.config.REDIS_URL` | Redis URL supplied to the backend. |
| `backend.config.CORS_ORIGIN` | Browser origin for the application. Staging supplies its example frontend HTTPS origin; defaults and production require an explicit deployment override. |
| `backend.config.LOG_LEVEL` | Backend log verbosity. |
| `backend.config.ENABLE_CACHING`, `backend.config.CACHE_TTL` | Cache controls supplied to the backend. |
| `backend.config.SDS_ENABLE` | SDS control supplied by staging. |
| `backend.config.RATE_LIMIT_API_MAX` | API request limit supplied by staging. Other supported backend environment controls can use the same `backend.config` mapping. |

The [backend environment parser](../../backend/src/config/env.ts) defines the
runtime modes, rate-limit defaults and other application controls. Forwarding
a value does not create a new application feature. There is no template consumer
for top-level `features.*`. The legacy `AUDIT_LOGGING_ENABLED`,
`ADVANCED_RATE_LIMIT_ENABLED` and `TENANT_ISOLATION_STRICT_MODE` flags are
documented by the backend as deprecated, with those security features always on.

The Secret template renders these **named** entries; it does not iterate over
arbitrary additions to `backend.secrets`:

| Path | Secret key |
|---|---|
| `backend.secrets.DATABASE_URL` | `DATABASE_URL` |
| `backend.secrets.DB_USER` | `DB_USER` |
| `backend.secrets.DB_PASSWORD` | `DB_PASSWORD` |
| `backend.secrets.JWT_SECRET` | Access-token signing key, `JWT_SECRET`. |
| `backend.secrets.JWT_REFRESH_SECRET` | Independent refresh-token signing key, required for the production runtime. |
| `backend.secrets.STELLAR_SECRET_KEY` | `STELLAR_SECRET_KEY` |
| `backend.secrets.ANCHOR_API_KEY` | `ANCHOR_API_KEY` |
| `backend.secrets.SDS_API_KEY` | `SDS_API_KEY` |

### Ingress and Stellar

| Path | Consumer and behavior |
|---|---|
| `ingress.enabled` | Creates the ingress resource. |
| `ingress.className` | Ingress controller class. |
| `ingress.annotations` | Controller-specific annotations, including the body limit and cert-manager issuer in the presets. |
| `ingress.hosts[].host` | Public host matched by a rule. Replace the example hostnames. |
| `ingress.hosts[].paths[].path`, `ingress.hosts[].paths[].pathType` | Request path and Kubernetes path-matching type. The current presets use `/` with `Prefix`. |
| `ingress.hosts[].paths[].service` | Suffix of the target chart Service, `frontend` or `backend`. |
| `ingress.hosts[].paths[].port` | Target Service port. |
| `ingress.tls[].secretName`, `ingress.tls[].hosts` | TLS Secret name and covered public hosts. |
| `stellar.network` | Preset label; no current template emits this field as an environment variable. |
| `stellar.passphrase` | Backend `STELLAR_NETWORK_PASSPHRASE`. |
| `stellar.horizonUrl` | Backend `STELLAR_HORIZON_URL`. |
| `stellar.sorobanRpcUrl` | Backend `SOROBAN_RPC_URL`. |

Configure the three effective Stellar values together. They are emitted beside
`backend.config` in the backend ConfigMap. Do not repeat those generated
environment names inside `backend.config`, which would create duplicate YAML
keys. The chart's ingress paths do not add or remove `/api` or `/api/v1`.

### Frontend image configuration

Every `frontend.config` entry becomes a container runtime environment variable.
The supplied keys are `VITE_API_URL`, `VITE_STELLAR_NETWORK`,
`VITE_STELLAR_NETWORK_PASSPHRASE` and `VITE_STELLAR_HORIZON_URL`. Staging and
production currently inherit all four default entries, including the internal
`http://payd-backend:3001` URL and TESTNET labels.

This chart selects a prebuilt frontend image. The supplied
[frontend Dockerfile](../../frontend/Dockerfile) builds static Vite assets and
serves them through Nginx on port 80. Follow the
[frontend deployment guide](../../frontend/DEPLOYMENT.md#build-a-staging-image)
to build an image with the environment's public API origin and matching Stellar
network, Horizon and Soroban RPC endpoints, then select that image through
`frontend.image.repository` and `frontend.image.tag`.

Those public settings are established when the assets are built. The chart does
not rebuild them, and the supplied image has no mechanism that copies pod
environment variables into browser configuration. Changing `frontend.config`
alone therefore does not change an existing bundle. Do not use a cluster-only
service hostname as a public browser URL.

The checked-in [Vite configuration](../../frontend/vite.config.ts) exposes both
`PUBLIC_` and `VITE_` build inputs. Nonempty `PUBLIC_` Stellar values take
precedence over their corresponding legacy `VITE_` aliases. Values under either
prefix are bundled into client code; use them only for public configuration.

The shared [API configuration](../../frontend/src/config/api.ts) resolves one
origin from `VITE_API_URL`, with `VITE_API_BASE_URL` and `VITE_BACKEND_URL` as
compatibility aliases. Legacy values ending in `/api` or `/api/v1` normalize to
the same origin before clients add their route prefixes:

| Source consumer | Current path composition |
|---|---|
| `frontend/src/services/scheduleApi.ts` | Shared `API_BASE_URL` plus `/schedules` gives `/api/schedules`. |
| `frontend/src/services/benefitsApi.ts`, `forecastApi.ts` | Shared `API_V1_BASE_URL` supplies the `/api/v1` prefix. |
| `frontend/src/services/transactionHistory.ts` | Uses `API_V1_BASE_URL` for `/api/v1/audit` and `API_BASE_URL` for `/api/events/...`. |
| `frontend/src/providers/SocketProvider.tsx` | Passes shared `API_ORIGIN` to Socket.IO, without an API prefix. |
| `frontend/src/services/contracts.ts` | Uses shared `API_BASE_URL` for `/api/contracts`. |

A deliberate same-origin build requires a reverse proxy for backend paths; the
static Nginx image does not supply that proxy. The chart's separate frontend and
backend hosts require an explicit public API origin. See the deployment guide
for the supported build inputs and route configuration.

Consistent host and prefix composition does not add missing backend handlers.
The deployment guide separately records the still-unmounted `/api/v1/claims`,
`/api/v1/bulk-payments`, `/api/withdrawal` and
`POST /api/v1/payments/pathfind` contracts. The corresponding current mounts
are in [backend/src/app.ts](../../backend/src/app.ts) and
[backend/src/routes/v1/index.ts](../../backend/src/routes/v1/index.ts).

## Render the configured chart

The render command also needs a refresh-key input because every bundled preset
uses the production runtime. For a **local manifest check only**, provide an
obvious disposable placeholder through a temporary file:

```bash
render_dir="$(mktemp -d)"
trap 'rm -rf "$render_dir"' EXIT
printf '%s' 'RENDER_ONLY_NOT_A_SIGNING_KEY' > "$render_dir/refresh-key"

helm template payd charts/payd \
  --set-file backend.secrets.JWT_REFRESH_SECRET="$render_dir/refresh-key" \
  > "$render_dir/default.yaml"

helm template payd charts/payd -f charts/payd/values-staging.yaml \
  --set-file backend.secrets.JWT_REFRESH_SECRET="$render_dir/refresh-key" \
  > "$render_dir/staging.yaml"

helm template payd charts/payd -f charts/payd/values-production.yaml \
  --set-file backend.secrets.JWT_REFRESH_SECRET="$render_dir/refresh-key" \
  > "$render_dir/production.yaml"
```

Never install those placeholder manifests. Use private deployment values for an
actual installation.

On the chart containing the refresh-key repair, Helm 3.19.0 rendered all three
presets successfully with that local input. Each produced eight resources and
passed the supplied refresh value to the backend Secret. The observed HPA
ranges, frontend replicas, resources, backend endpoints and inherited frontend
environment matched the tables above. This confirms manifest rendering; it
does not establish cluster readiness, browser-to-API connectivity or capacity.
