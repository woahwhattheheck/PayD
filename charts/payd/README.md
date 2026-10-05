# PayD Helm chart

This chart deploys the PayD backend and frontend. `values.yaml` is the base configuration; environment files override only the settings that differ for that environment.

## Install or upgrade

Development/default values:

```sh
helm upgrade --install payd charts/payd
```

Staging:

```sh
helm upgrade --install payd charts/payd -f charts/payd/values-staging.yaml
```

Production:

```sh
helm upgrade --install payd charts/payd -f charts/payd/values-production.yaml
```

Helm applies files from left to right, so later `-f` files and `--set` values take precedence. Keep credentials out of committed values files; provide them through the deployment secret workflow or explicit secret overrides.

## Values

| Value | Default | Purpose |
| --- | --- | --- |
| `global.imageRegistry` | `""` | Optional registry prefix for backend and frontend images. |
| `global.imagePullSecrets` | `[]` | Kubernetes image pull secrets. |
| `backend.enabled` | `true` | Enable the backend Deployment and ConfigMap. |
| `backend.replicaCount` | `2` | Fixed backend replicas when autoscaling is disabled. |
| `backend.image.repository` | `payd-backend` | Backend image repository. |
| `backend.image.tag` | `latest` | Backend image tag. Environment/deployment automation may override it. |
| `backend.image.pullPolicy` | `IfNotPresent` | Backend image pull policy. |
| `backend.service.type` | `ClusterIP` | Backend Service type. |
| `backend.service.port` | `3001` | Backend service/container port. |
| `backend.resources` | see `values.yaml` | Backend CPU/memory requests and limits. |
| `backend.autoscaling.enabled` | `true` | Enable the backend HorizontalPodAutoscaler. |
| `backend.autoscaling.minReplicas` | `2` | Minimum backend replicas. |
| `backend.autoscaling.maxReplicas` | `10` | Maximum backend replicas. |
| `backend.autoscaling.targetCPUUtilizationPercentage` | `70` | CPU scaling target. |
| `backend.autoscaling.targetMemoryUtilizationPercentage` | `80` | Memory scaling target. |
| `backend.healthCheck` | see `values.yaml` | Backend liveness/readiness probes. |
| `backend.config` | see `values.yaml` | Environment variables rendered into the backend ConfigMap. This is also the environment-specific feature/config map; for example `LOG_LEVEL`, `ENABLE_CACHING`, and `CACHE_TTL` can differ by values file. |
| `backend.secrets` | empty/safe placeholders | Backend secret values. Supply real credentials outside committed environment files. |
| `frontend.enabled` | `true` | Enable the frontend Deployment. |
| `frontend.replicaCount` | `2` | Frontend replicas. |
| `frontend.image.repository` | `payd-frontend` | Frontend image repository. |
| `frontend.image.tag` | `latest` | Frontend image tag. Environment/deployment automation may override it. |
| `frontend.image.pullPolicy` | `IfNotPresent` | Frontend image pull policy. |
| `frontend.service.type` | `ClusterIP` | Frontend Service type. |
| `frontend.service.port` | `80` | Frontend service port. |
| `frontend.resources` | see `values.yaml` | Frontend CPU/memory requests and limits. |
| `frontend.config` | see `values.yaml` | Environment variables rendered into the frontend container. Values files can override or add keys. |
| `ingress.enabled` | `true` | Enable ingress. |
| `ingress.className` | `nginx` | Ingress class. |
| `ingress.annotations` | see `values.yaml` | Ingress-controller and certificate annotations. |
| `ingress.hosts` | example hosts | Host/path/service mappings. Replace example domains for each deployment. |
| `ingress.tls` | example secret/hosts | TLS secret and host mappings. |
| `stellar.network` | `TESTNET` | Stellar network label. |
| `stellar.passphrase` | testnet passphrase | Network passphrase exposed to backend configuration. |
| `stellar.horizonUrl` | testnet Horizon | Horizon endpoint. |
| `stellar.sorobanRpcUrl` | testnet RPC | Soroban RPC endpoint. |

## Environment profiles

`values-staging.yaml` keeps Stellar on TESTNET, uses two replicas, and sets resource limits between the base and production profiles. It also demonstrates environment-specific backend configuration without changing the chart schema.

`values-production.yaml` switches Stellar to MAINNET, increases replicas/resources and autoscaling limits, and adds production ingress/certificate settings.

For a real deployment, override the example ingress domains and all secret values. Do not commit private keys, JWT secrets, database passwords, or provider API keys.
