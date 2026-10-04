# Helm backend probe acceptance — 4 October 2026

Source parent: `a3099111c392b504565cd27a6c0c6f4d952a33fe`. Native Helm: `v3.19.0+g3d8990f`.
[Executed validation](https://github.com/woahwhattheheck/PayD/actions/runs/37193463341).

The unchanged chart rendered defaults, staging and production with `/health`
for liveness and no startup probe. The repaired chart renders all three presets
with startup/liveness `/health/live`, readiness `/health`, and the named `http`
container port. Every other field in every rendered Kubernetes resource was
compared structurally and remained identical, including HPA, images, environment,
Secrets, frontend, Service and ingress.

Additional native renders preserved a configured port of 8088 through the named
probe port, omitted startup when its mapping was null, preserved a custom
startup path/port/timeout, and omitted a disabled backend. Missing production
refresh-key input remained a rendering error. All render inputs used an obvious
disposable placeholder, never live credentials; no manifest was installed.

## Reproduce

The pinned validation carrier contains `accept.py`, which runs the real Helm
CLI, applies the three-file patch and compares parsed rendered resources. It
uses PyYAML only in the validation runner; the product has no new dependency.
The executed source files are identified below:

- `charts/payd/values.yaml`: `41817d1a7cbf93873294d5524b9f00ddc234ac08`.
- `charts/payd/templates/backend-deployment.yaml`: `0fd2a64369a492f7bb5ad7493557689842c7fafa`.
- `charts/payd/VALUES.md`: `51ddcdd8cbea7600b999b37000abb13dff6b9084`.

The action retains before/after manifests, errors and machine-readable results.
This establishes chart rendering and probe configuration, not a running cluster,
load result, dependency-outage experiment, deployment or bounty acceptance.
No backend health handler, authentication, secret template or frontend source
was modified. The isolated runner is not included in the product branch.
