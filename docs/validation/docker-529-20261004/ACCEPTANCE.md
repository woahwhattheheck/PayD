# Docker acceptance for issue #529

The Docker contribution in [PR #633](https://github.com/Protocol-Guild/PayD/pull/633) passes the measured image-size, non-root, multi-stage Alpine, configured HEALTHCHECK, and dependency-cache criteria at product commit `16b3e8a4a967fe403dc313956a92214b172ed966`. The image is **198,093,652 uncompressed bytes (198.094 MB)**, below the explicit 200,000,000-byte limit by **1,906,348 bytes**. The retained Node runtime and the package entrypoints affected by image trimming also executed successfully.

This report describes one Linux amd64 native acceptance run. It does not claim application/database health, a complete repository test pass, sponsor approval, a bounty award, or payment. The earlier failed attempts remain available in the [build-prerequisite report](README.md) and [oversize measurement](combined-oversize/result.json).

## Measured acceptance

| Criterion | Executed observation | Result |
| --- | --- | --- |
| Image below 200 MB | `docker image inspect` reports 198,093,652 uncompressed bytes; threshold is decimal 200,000,000 bytes | Pass |
| Non-root runtime | Configured user `payd`; a network-disabled container reports UID 100 | Pass |
| Multi-stage Alpine | Node Alpine builder and production-dependency stages, then Alpine 3.23 runtime; observed Alpine 3.23.6 | Pass |
| HEALTHCHECK | Image metadata retains `wget -qO- http://127.0.0.1:${PORT:-3001}/health/live`, 30-second interval, 5-second timeout, 20-second start period and 3 retries | Configured; application endpoint was not executed |
| Dependency caching | Both actual `npm ci` steps (`builder` and `production-deps`) are `CACHED` after one temporary comment is appended to `backend/src/index.ts` | Pass |
| Retained runtime and packages | v20.20.2; Stellar SDK sign/verify, Stellar Base verify and ExcelJS XLSX buffer write/read roundtrip execute with networking disabled | Pass; optional native acceleration is recorded separately |

The initial build took **72.91 seconds** and the source-only rebuild took **5.93 seconds** on the same runner. These are single-run wall-clock observations. The explicit cached-layer records establish dependency reuse; the timings are not a fleet-throughput benchmark.

## What changed and why

The original image could not reach the acceptance checks because compilation failed. The contribution reuses an existing class-brace repair and the reviewed strict production compiler prerequisites from PR #635. The production build uses `tsconfig.build.json`, extends the original strict configuration and retains `noEmitOnError`. The Docker builder copies `tsconfig*.json` so that configuration is present. The separate full-source typecheck command remains available. The earlier attempt's 102 test-file diagnostics are recorded as historical debt; this run does not claim that full-source test typecheck passes.

Rill's runtime ownership change avoids a recursive `chown` layer over installed dependencies: runtime installation and copied files receive their final owner directly. With the compiler fixes and that ownership change, source `9f05ce2afe17af24a46b030b60f76b8a4f6ee99c` built successfully but still measured **246,366,943 bytes**, so the size criterion failed. Its [raw result](combined-oversize/result.json), [layer history](combined-oversize/image-history.txt) and [footprint](combined-oversize/runtime-footprint.txt) are preserved.

The final Dockerfile adds a production-dependency stage and copies its Node binary and official entrypoint into matching Alpine 3.23 with `libstdc++` and `wget`. npm, Yarn and C/C++ headers remain in the build stages. Removing them in a later layer of the same inherited image would not remove their underlying image bytes. The Node image is pinned to the exact digest used in the earlier measurement.

Only three browser-bundle directories are removed from installed dependencies: `exceljs/dist`, `@stellar/stellar-sdk/dist`, and `@stellar/stellar-base/dist`. Their locked Node entrypoints use `excel.js` or `lib/`; those files and all native bindings remain. The package lockfile stays at blob `2803b2048d296fadbd21baae3ad89b660226cd47`. This reduces the measured image by **48,273,291 bytes (19.59%)** relative to the successful but oversized image.

The existing Compose, Helm, Kubernetes and ECS backend definitions were checked at the preceding product commit. They inherit the image command and entrypoint; none invokes npm, Yarn, npx or Corepack in the running backend image. The image keeps `node dist/index.js`, `/usr/src/app`, port 3001, the official Node entrypoint and the `payd` runtime user. Container operations that intentionally need a package manager should use a build stage or a development image.

### Optional native signing

The first build of the slimmer product measured 198,093,652 bytes but its workflow stopped at an extra direct `require('sodium-native')` check. The error was `ADDON_NOT_FOUND` for a `linux-x64-musl` addon. Because that workflow stopped there, it did not execute the cache probe and did not produce a final result. The [exact failed check](optional-native-check/runtime-smoke-error.log), [full native job log](optional-native-check/native-job.log), original image metadata and empty runtime-result file are preserved.

The locked package marks `sodium-native` as optional, and [Stellar Base 12.1.1 signing code](https://github.com/stellar/js-stellar-base/blob/v12.1.1/src/signing.js) explicitly catches native loading failures and selects TweetNaCl. The corrected acceptance workflow requires the actual SDK signing/verification and ExcelJS operations to pass, and records optional native availability and the SDK's `FastSigning` flag separately. In the final image it observed 13 native prebuild target directories, no `linux-x64-musl` directory, both attempted musl addon files absent, and `FastSigning: false`. The product Dockerfile and dependency lockfile did not change to make that correction. Native signing acceleration is not claimed.

## Reproducible evidence

| Identity | Value |
| --- | --- |
| Product commit | `16b3e8a4a967fe403dc313956a92214b172ed966` |
| Dockerfile blob | `22464e99c7126c051d674a34ff15e6ed5fa60424` |
| Package-lock blob | `2803b2048d296fadbd21baae3ad89b660226cd47` |
| Image ID | `sha256:62316961ed6e1e23c2eecc8ecb2311237a63ad3bc619a0a59dc39523f4fc7e3f` |
| Node base digest | `sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293` |
| Final Alpine base digest | `sha256:85fe1e81d6758c208f3e1eed4338a1997e19d4be002d4dd32d3100c9a8c010a0` |
| Workflow controller | [`be55f1d69920`](https://github.com/woahwhattheheck/PayD/blob/be55f1d69920089e2b059af72f0070c164ba5199/.github/workflows/payd633-docker-acceptance.yml) |
| Native run / job | [37195859147 / 111417452161](https://github.com/woahwhattheheck/PayD/actions/runs/37195859147/job/111417452161) |
| Downloaded artifact | `11301155924` |
| Downloaded ZIP SHA-256 | `dadda645e90a45525696a8c0c95bb417582ade5d7a7ac13485840c41aa834a31` |

The isolated workflow uses one standard Ubuntu 24.04 runner with a 15-minute limit. It checks out the immutable product SHA with persisted checkout credentials disabled, verifies the Dockerfile blob, builds the unchanged image, records image metadata/history/identity, exercises the retained runtime packages, then makes the temporary source-only cache probe. The comment exists only in the runner checkout and does not change the contribution. No image is pushed or application deployed.

The exact [workflow](https://github.com/woahwhattheheck/PayD/blob/be55f1d69920089e2b059af72f0070c164ba5199/.github/workflows/payd633-docker-acceptance.yml), [machine-readable result](accepted/result.json), [build log](accepted/first-build.log), [rebuild log](accepted/cached-build.log), [runtime checks](accepted/runtime-smoke.json), [source/tool identity](accepted/source-tools.txt) and [file-hash manifest](acceptance-manifest.json) support the table above. The manifest records all three later attempts, their downloaded archive hashes, and each retained file. Raw evidence is committed here so the receipt survives runner-artifact retention.

## Packaging and consumer references

- [Official Node Alpine 3.23 runtime recipe](https://github.com/nodejs/docker-node/blob/0001669cfeee81ddd41a0a16be9321e8a1bf2354/20/alpine3.23/Dockerfile) and [entrypoint](https://github.com/nodejs/docker-node/blob/0001669cfeee81ddd41a0a16be9321e8a1bf2354/docker-entrypoint.sh).
- [ExcelJS 4.4.0 package entrypoints](https://github.com/exceljs/exceljs/blob/v4.4.0/package.json) and [Node entry file](https://github.com/exceljs/exceljs/blob/v4.4.0/excel.js).
- [Stellar SDK 12.3.0 package entrypoints](https://github.com/stellar/js-stellar-sdk/blob/v12.3.0/package.json) and [Stellar Base 12.1.1 package entrypoints](https://github.com/stellar/js-stellar-base/blob/v12.1.1/package.json).
- Consumer definitions: [Compose](../../../backend/docker-compose.yml), [Helm](../../../charts/payd/templates/backend-deployment.yaml), [Kubernetes](../../../k8s/base/backend-deployment.yaml) and [ECS](../../../infrastructure/terraform/modules/ecs/main.tf).
