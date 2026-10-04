# PR #632 canonical indexer test result

Date: 2026-10-04 UTC  
Attribution: Astra Beacon, GPT-6 Astra Pro, ChatGPT cloud harness.

## Result and source

The maintained canonical indexer Jest file passed **16 of 16 tests**, with one suite passed and zero failed, pending, or todo tests. This is the cleanup implementation retained for [Protocol-Guild/PayD#632](https://github.com/Protocol-Guild/PayD/pull/632), whose linked [issue #522](https://github.com/Protocol-Guild/PayD/issues/522) requires existing tests to pass.

- Cleanup parent: `66125345c5713e6f997053b73615c4a0e9534e1a`.
- Executed source: [`7ca1af916d8323d728df15b28606c2e5162db2af`](https://github.com/woahwhattheheck/PayD/commit/7ca1af916d8323d728df15b28606c2e5162db2af).
- [Native run 37194187229](https://github.com/woahwhattheheck/PayD/actions/runs/37194187229), job `111412506434`.
- [Durable result JSON](https://github.com/woahwhattheheck/PayD/blob/89f4de90be56b1f498e15a83e368079871a18b99/evidence/payd632/cleanup-16-result.json) and [complete job log](https://github.com/woahwhattheheck/PayD/blob/89f4de90be56b1f498e15a83e368079871a18b99/evidence/payd632/cleanup-16-37194187229.log).

The source change adds `(global.fetch as jest.Mock).mockReset();` at the start of the outer `beforeEach`, before constructing the indexer. It clears unused one-shot responses between cases. The earlier 24-case source exposed this fixture leak: the overlap test left a queued failure that contaminated the following raw-XDR case. [That failed run](https://github.com/woahwhattheheck/PayD/actions/runs/37193783252) passed 23 cases and failed one.

All 16 cleanup cases and their assertions remain intact. Production code, the cleanup split, and the concurrent controller fixture correction are preserved. Raw-XDR and cursor traversal source stays in the separate ingestion follow-up.

## Reproduce

From `backend`, using the repository lockfile and unchanged Jest configuration:

```bash
npm ci --no-audit --no-fund
npm test -- --config jest.config.cjs --runInBand --runTestsByPath src/services/__tests__/contractEventIndexer.test.ts --json --outputFile="$RUNNER_TEMP/payd632-evidence/jest-results.json"
```

Create the output directory first when reproducing outside the workflow.

Execution used a standard public Ubuntu 24.04 runner, Node `v22.23.3`, npm `10.9.9`, Jest `30.2.0`, ts-jest `29.4.12`, TypeScript `5.9.3`, and Stellar SDK `12.3.0`. No tracked source diff remained during execution. The selected file uses its existing RPC/database mocks; no live RPC or PostgreSQL service was used. This evidence covers this maintained Jest file, not the full suite or typecheck. The repository configuration retains `diagnostics: false`.

## Executed Git blobs

| Input | Git blob |
| --- | --- |
| `backend/src/services/contractEventIndexer.ts` | `4232a79a0d4e87087384dc98fd8bfc73c605ee36` |
| `backend/src/services/__tests__/contractEventIndexer.test.ts` | `a640ba8f1cf79add307f820cc722b13b316971dc` |
| `backend/src/types/contractEvent.ts` | `174be489aa61c9abbce0172d6b6a12935186499f` |
| `backend/jest.config.cjs` | `7b6e52a7558480442e1b9e160ea523b9f165e72c` |
| `backend/tsconfig.json` | `9bcf755fb55656c2454fa6bc097e562da91cc383` |
| `backend/package.json` | `746a535b08bf0c6ce9c4a96f7d75c76e0bbacb95` |
| `backend/package-lock.json` | `2803b2048d296fadbd21baae3ad89b660226cd47` |

The later report-only commit does not change these executed inputs.
