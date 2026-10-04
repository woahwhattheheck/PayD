# PayD #521: original PR #626 frontend build acceptance

The original contribution's frontend build passed on October 4, 2026. No application source or dependency changes were needed.

## Contribution and execution

- Issue: https://github.com/Protocol-Guild/PayD/issues/521
- Original PR: https://github.com/Protocol-Guild/PayD/pull/626
- Executed product source: `3f4b52a039aa40b7098f6bee25ca8bc347e5a836`
- Original branch: `woahwhattheheck/PayD:type/payd-521-orphans`
- Product tree: `5fa1bd6e099f0e650e808201e941a769c81e9f38`
- Successful run: https://github.com/woahwhattheheck/PayD/actions/runs/37191914780
- Successful job: `111405729965` (`frontend-build`)
- Executed workflow commit: `299c3c4ea22e70a168d3f668c1eec88532298b97`
- Workflow branch: `validation/payd626-build-e267-20261004`
- Workflow blob: `21deb5f6c92c66906b5036865cb3fc71d95713fc`

The workflow checks out the product commit explicitly. Its separate branch removes the five inherited workflows before adding this single bounded build job. This prevents the validation branch from invoking the unrelated release, IPFS, E2E, generic build or secrets workflows. The source branch and upstream PR remain the original contribution.

## Actual commands and results

The issue requires deletion of `src_backup/` and root `upstream_*.tsx`, no broken imports, and a passing build. The repository's application build step runs inside `frontend`; its existing build script is `tsc -b && vite build`.

```bash
cd frontend
npm ci --legacy-peer-deps
npm run build
```

| Observation | Actual result |
| --- | --- |
| Runner | Standard GitHub-hosted `ubuntu-latest`, one job, 15-minute timeout |
| Node / npm | `v22.23.3` / `10.9.9` |
| Lock-defined install | Exit `0`; 1,084 packages added; 39 whole elapsed seconds |
| Existing frontend build | Exit `0`; 20 whole elapsed seconds |
| Vite | `7.2.6`; 2,815 modules transformed; reported bundling time 12.53 seconds |
| Tracked orphan paths | No `src_backup/` or root `upstream_*.tsx` paths found |
| Orphan source references | Empty scan across tracked TS, TSX, JS, JSX and JSON files |
| TypeScript | `tsc -b` succeeded before Vite ran |

The run used the actual repository configuration, lockfile and source. It did not insert client stubs, alter configuration, upgrade dependencies, or replace the build command. The frontend build succeeded without running the generic workflow's separate Stellar Scaffold deployment/client-generation stage. No additional lint, formatting, contract, E2E or application test matrix was run.

The job began at approximately 09:22 UTC and completed at approximately 09:23 UTC. These are build and installation durations, not application performance benchmarks.

## Retained output

- [Exact build log](build.log)
- [Exact install log](install.log)
- [Recorded environment and input hashes](environment.txt)
- [Recorded commands](commands.txt)
- [Orphan-reference scan](orphan-references.txt)
- [Build exit](build.exit) / [install exit](install.exit)

The build log records the production outputs: HTML 0.97 kB, CSS 92.13 kB, and JavaScript 2,453.57 kB (728.50 kB gzip). Vite emitted its large-chunk warning. The unchanged lock-defined install emitted deprecation messages and reported 83 dependency advisories (22 low, 20 moderate, 37 high, 4 critical). Neither warning changed the successful install/build exit. This task made no dependency remediation claim or unrelated source change.

The GitHub artifact `payd626-build-e267-37191914780`, ID `11299695409`, is 1,045,853 bytes. Its downloaded ZIP matches the provider digest:

```text
sha256:a54299c1b5e0c6d925b741844c2d21ec791f597f1cd25eefce5ab4351521a97e
```

It contains the exact product source archive, input hashes, commands, install/build logs, exits and elapsed times. The tiny result files above are retained with this report so the observed result remains reviewable after the artifact's seven-day retention expires. The product source remains identified by its immutable Git commit.

Raw build log SHA-256: `74a5d9742ed09facc3fad4cebeb9de9b9eee21c8ee318fe4cd14d7bd409cdfec`.

Raw install log SHA-256: `d429bba5ec9a151e94a6f1306fa7690b23cd7997d6409b1e379586bc48506f7c`.

## Scope and acceptance status

This closes the missing frontend build evidence for the original orphan-file removal contribution at the executed source. No repair was necessary, and no repeated successful build is requested.

Upstream review and merge remain with the maintainer. The earlier upstream build and secrets runs required maintainer action; this independent owner-fork result does not change their conclusions. The issue remains labelled `Maybe Rewarded` / `GrantFox OSS` / `Third Campaign`; no issue-specific award, sponsor acceptance or payment is established by this execution.

Coordination: `PAYD626-BUILD-E267`, GPT-6 Astra Pro, `bounty_frontier` for `astra-e267d73f`, ChatGPT cloud harness. Original implementation and Copper13A0's workflow-repair attribution are preserved.
