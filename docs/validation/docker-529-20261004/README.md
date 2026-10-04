# Docker build prerequisites for issue #529

Later production build repairs and image-size work are documented in the [completed Docker acceptance report](ACCEPTANCE.md). The two failed attempts below remain historical evidence for their exact source commits.

These are the two initial, source-pinned Docker build attempts for [issue #529](https://github.com/Protocol-Guild/PayD/issues/529) and [the existing contribution #633](https://github.com/Protocol-Guild/PayD/pull/633). Both stopped at TypeScript compilation before a final image was exported. They establish concrete build prerequisites; they do not establish image-size, runtime-user, healthcheck-execution, or dependency-cache acceptance.

## Executed sources and results

| Attempt | Product commit | Native run | Result |
| --- | --- | --- | --- |
| Original contribution | `b6aeb6f162c01145188cf77ce3ac80945f8935e8` | [37192310507](https://github.com/woahwhattheheck/PayD/actions/runs/37192310507) | Both dependency installations completed; `npm run build` stopped on an early class-closing brace in `tenantConfigService.ts`. |
| Exact class-brace correction | `9507c7c7e3634cc6e3f85da8fb8a04ca400d5c88` | [37192699510](https://github.com/woahwhattheheck/PayD/actions/runs/37192699510) | Syntax blocker cleared; strict compilation reported 177 distinct diagnostics: 102 in tests and 75 in 23 production files. No final image was exported. |

The second source reuses the existing contribution #635's class correction: remove the premature closing brace and adjacent blank line, retaining the two rate-limit methods inside `TenantConfigService`. No method, query, or value was changed.

The independent workflow repair at [55b4bc5a](https://github.com/woahwhattheheck/PayD/commit/55b4bc5a9cc1ca234610c17581acb35f31fbe842) removes the invalid root-level `retention-days` key and selects explicit Bash for the Scaffold pipeline. Its controlled failed-producer check changed the pipeline exit status from 0 to 23 while preserving log bytes. The sponsor's subsequent workflow was admitted and required approval; that is not a hosted test pass.

## Measurement method

Each attempt used one standard Ubuntu 24.04 GitHub runner with a 15-minute job limit. The checkout pinned the product commit, disabled persisted checkout credentials, and checked the Dockerfile blob before building. The native Docker build used the unmodified contribution Dockerfile and package lockfile.

- Dockerfile: `da34233df80f6fa808ef01bb2c9a12cee1d13750`
- Package lockfile: `2803b2048d296fadbd21baae3ad89b660226cd47`
- Resolved base: `node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293`
- Docker Engine: 28.0.4, Linux amd64
- Buildx: 0.37.1

The [first workflow](https://github.com/woahwhattheheck/PayD/blob/9c9ef359c61da978d44e014df1179faff0217d4c/.github/workflows/payd633-docker-acceptance.yml) and [second workflow](https://github.com/woahwhattheheck/PayD/blob/d136d454f9a145203d5b29ed971315d6aa3a368d/.github/workflows/payd633-docker-acceptance.yml) identify the exact commands. The second changes the pinned product source.

The planned checks after a successful build are an uncompressed image size below 200,000,000 bytes, observed nonzero runtime UID, Alpine/multi-stage configuration, configured HEALTHCHECK, and a second build after a temporary source-only comment to demonstrate cached dependency layers. Those later steps were skipped because compilation failed. Timing files from failed commands include a nonzero-exit diagnostic and must not be interpreted as successful image-build performance.

## Retained evidence

The directories below preserve complete downloaded build logs, exact source/tool identities, machine-readable failure results, and the second run's classified compiler diagnostics. The manifest records file hashes and the downloaded archive digests.

| Directory | Native job | Downloaded artifact |
| --- | --- | --- |
| [original](original/) | 111406907149 | 11299217744 |
| [class-brace-repair](class-brace-repair/) | 111408065486 | 11299786182 |

These diagnostic records remain applicable to the pinned commits even if later source repairs or Docker optimizations are added to the contribution. They are not an application/database runtime test, a final Docker acceptance result, or a reward/payment receipt.
