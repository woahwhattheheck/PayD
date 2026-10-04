# PayD #631: maintained controller acceptance and fixture repair

## Published outcome

Original [Protocol-Guild/PayD PR #631](https://github.com/Protocol-Guild/PayD/pull/631), for [issue #523](https://github.com/Protocol-Guild/PayD/issues/523), now contains the two-line test-fixture repair in [commit 6f8876250a335f5cfd8698a51bfdd4c6df5559e4](https://github.com/woahwhattheheck/PayD/commit/6f8876250a335f5cfd8698a51bfdd4c6df5559e4). Its sole parent is `98bad9c9ff9cbf2bce4c050975419188c7dd0ba9`; its tree is `3134a187192de3f8a8eb2498d563737145daefef`. Native readback confirms the original branch is open, mergeable and unmerged, with exactly two files changed, +2/-0. Production code and existing test assertions are unchanged.

Each fixture now marks its mocked database module with `__esModule: true`, allowing the existing default import to resolve to the mocked pool. The controller repair was executed here. The indexer repair copies an exact previously tested fixture, with its earlier execution explicitly identified below.

Issue #523 requires one canonical events controller, canonical route imports, deletion of the duplicate, and passing tests; controller refactoring is out of scope. It is labeled **Maybe Rewarded**, GrantFox OSS, Third Campaign. This receipt establishes focused source and unit-test evidence; it does not establish sponsor acceptance or an awarded payment.

## Actual controller execution

One standard public `ubuntu-latest` job used Node **22.23.3**, npm **10.9.9**, the existing backend lock, and the repository's unmodified Jest configuration. The source checkout was pinned to `98bad9c9ff9cbf2bce4c050975419188c7dd0ba9`.

```sh
cd backend
npm ci --legacy-peer-deps --no-audit --no-fund
npm test -- --runInBand --runTestsByPath src/controllers/__tests__/contractEventController.test.ts
```

The job adds Jest's `--json --outputFile=...` only to preserve machine-readable results. Installation succeeded, installing 826 lock-defined packages in seven seconds.

| Execution | Existing cases | Passed | Failed | Exit |
| --- | ---: | ---: | ---: | ---: |
| Original controller fixture | 8 | 2 | 6 | 1 |
| Same suite after the single module marker | 8 | 8 | 0 | 0 |

The six baseline failures were `Cannot read properties of undefined` errors when the tests attempted to configure `pool.query` mock methods. The two organization-rejection cases already passed. The job required the exact eight-case collection and this failure signature before adding the single marker, then reran the same cases in the same job. It retained every assertion and all production bytes.

The passing suite covers contract-specific pagination, organization rejection, query filters, organization-wide events, indexer status, missing status, and database-error response handling. The simulated database-error case intentionally emits an error log while passing its existing response assertions.

- [Run 37193338932](https://github.com/woahwhattheheck/PayD/actions/runs/37193338932), job `111409960904`: completed successfully.
- Executed workflow commit: `3177ca20cd4390f32c6921bac1090dce70ec215f`; workflow blob: `39278da0e56423f5559f3d0ca62a78e7f35c732a`.
- [Artifact 11300001621](https://github.com/woahwhattheheck/PayD/actions/runs/37193338932/artifacts/11300001621): `payd631-controller-e267-37193338932`, 1,056,259 bytes, SHA-256 `b7d5a0dddb074699cd15f46d3c6e83b8e37749949d5405376a3213d03706daff`.
- Artifact expiry is 2026-10-11. The text logs, JSON results, exits, commands and input hashes are also preserved beside this receipt under `raw/`; the exact original source remains available at its Git commit.
- The resulting controller test blob is `71078ee8ed661f9ebf3a2127c1a4dd4fc9b54849`, matching the original-branch readback.

The job also confirmed that `backend/src/controllers/contractEventsController.ts` is absent and that there are no references to that deleted module in `backend/src`. The route and integration imports point to the surviving `contractEventController` file. These are source checks; the integration suite itself was not run here.

## Reused indexer execution — no new indexer run

FE25's [existing receipt](https://tokenjunkielabs.slack.com/archives/C0BVANHNB26/p1791098340317129) records **13 maintained canonical indexer tests passing** at `fd6407cfdd2f241ddaed9122b71c78d338b3cb5d`. Its database-mock marker was the only difference in that indexer test file compared with #631's original fixture.

The source update copies exact donor blob `deb1ad30bcb39160ea5864e06c9209c43b3b7705`; the old blob was `1e12a23b551726b750da1d0abe9fc4c19b0e85e2`. Adding only the marker to the old bytes produces the donor hash exactly. Both fixtures retain all thirteen existing tests and assertions.

The relevant source and configuration match between #631 and the executed `fd6407cf` donor:

| Input | Shared Git blob |
| --- | --- |
| `backend/src/services/contractEventIndexer.ts` | `432b30e5155c3ed7f607d6d68cb343868adc9f99` |
| `backend/src/config/database.ts` | `bd58cc3d8087fb6148d9d82f29411842713e4a09` |
| `backend/src/types/contractEvent.ts` | `174be489aa61c9abbce0172d6b6a12935186499f` |
| `backend/package.json` | `746a535b08bf0c6ce9c4a96f7d75c76e0bbacb95` |
| `backend/package-lock.json` | `2803b2048d296fadbd21baae3ad89b660226cd47` |
| `backend/jest.config.cjs` | `7b6e52a7558480442e1b9e160ea523b9f165e72c` |
| `backend/tsconfig.json` | `9bcf755fb55656c2454fa6bc097e562da91cc383` |

The donor's other backend differences concern its SQL migration/schema regression work, documentation and removed dead service. The indexer unit suite mocks database and RPC behavior. That prior result is reused within this matching unit-test input scope; the donor's SQL regression results are not claimed for #631.

## Reuse by the stacked #632 contribution

The read of #632 at `4669cdc0dcb0d893bf47b18ee9191df9d3ddcb1d` found its controller and controller fixture still identical to #631's original inputs: controller `4f8a0852043f2f282ce7b3bae1f2fc0f44cbed06`, test `dfb3c6f37537e12aa38dff770a87afe5222b153e`, route `941993180db59300ff6b98bd87ee8d7d6b90c2a7`. Its backend package, lock, Jest configuration and tsconfig also match the shared hashes above. Therefore the proven controller fixture blob can be ported directly by the current #632 owner after a fresh head check, with the execution attributed to this separate run.

#632 has since developed its indexer independently; this controller receipt does not certify that later indexer implementation. Its contract-event type file differs: #631 has blob `174be489aa61c9abbce0172d6b6a12935186499f`, while #632 at `4669cdc0` has `f561a78d6a73d20a6aae554f6a89737f69436d13`. The controller imports `ContractEventFilters` and `PaginatedContractEvents` with `import type`, and the unchanged Jest transform does not perform diagnostic typechecking. The shared runtime/test/configuration hashes establish the scope of the controller evidence; this is not a claim that every source input in the two branches is identical. No fresh run on #632 is claimed here.

## Scope and custody

The two source fixtures were published with one `force:false` update to `wire/payd-523-dead-controller`. Original PR and campaign custody are preserved. This receipt and the isolated workflow are on `validation/payd631-controller-e267-20261004`; that branch removes inherited broad and deployment workflows and must remain separate from the product branch.

No backend build, full suite, typecheck, live PostgreSQL or live RPC execution was performed by this task. The existing Jest configuration already has TypeScript diagnostics disabled; it was left unchanged. Eight controller cases were executed here, and thirteen indexer cases are reused from the explicitly linked earlier execution. These are distinct evidence sources, not a newly executed combined suite.

Controller execution and integration: **GPT-6 Astra Pro / astra-e267d73f / ChatGPT cloud**, 2026-10-04. Indexer fixture and its earlier execution: **FE25**, preserved with attribution.
