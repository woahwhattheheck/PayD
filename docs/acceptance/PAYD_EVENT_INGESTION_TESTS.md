# Event ingestion follow-up: maintained indexer test result

Date: 2026-10-04 UTC  
Attribution: Astra Beacon, GPT-6 Astra Pro, ChatGPT cloud harness.

## Result and source mapping

The maintained canonical indexer Jest file passed **24 of 24 tests**, with one suite passed and zero failed, pending, or todo tests. This selection includes the retained cursor traversal and SDK event-decoding cases.

- Executed source: [`2ad0076b92971dd087a7ca58a11bdc584eb1ad71`](https://github.com/woahwhattheheck/PayD/commit/2ad0076b92971dd087a7ca58a11bdc584eb1ad71), the fixture-only child of `4669cdc0dcb0d893bf47b18ee9191df9d3ddcb1d`.
- [Native run 37194035823](https://github.com/woahwhattheheck/PayD/actions/runs/37194035823), job `111412057283`.
- [Durable result JSON](https://github.com/woahwhattheheck/PayD/blob/89f4de90be56b1f498e15a83e368079871a18b99/evidence/payd632/fixed-24-result.json) and [complete job log](https://github.com/woahwhattheheck/PayD/blob/89f4de90be56b1f498e15a83e368079871a18b99/evidence/payd632/fixed-24-37194035823.log).
- Follow-up parent: `2c13d3cf2d4acad64815823f54a54a1fe0e17f68`, branch `fix/payd-event-ingestion-927f-20261004`.
- Published fixture source: [`f4b99f663b00589e916ddf4f9bebf40dca241571`](https://github.com/woahwhattheheck/PayD/commit/f4b99f663b00589e916ddf4f9bebf40dca241571).

The follow-up parent restored the ingestion implementation while preserving the cleanup and controller correction. Its selected source, original test, types, Jest/TypeScript configuration, package manifest, and lockfile were byte-identical to the original pre-fix inputs. Applying the exact tested fixture blob therefore produces the same seven input blobs listed below. The executed commit remains `2ad0076b`; this report reuses its scoped result through that explicit input mapping.

The original cleanup PR has its own [16-case result](https://github.com/woahwhattheheck/PayD/blob/834da4c03bb3130e17f0235e0fdd2fb4f1de16bf/docs/acceptance/PAYD632_CURRENT_INDEXER_TESTS.md). This independent ingestion follow-up retains the raw-XDR decoding and cursor changes separately.

## Fixture repair

The [initial native run](https://github.com/woahwhattheheck/PayD/actions/runs/37193783252) passed 23 of 24 cases. An unused one-shot fetch failure from the preceding overlap case contaminated the raw-XDR poll case. The outer setup cleared call history without clearing queued responses.

Adding `(global.fetch as jest.Mock).mockReset();` at the start of the outer `beforeEach`, before indexer construction, isolates those responses. All 24 cases and assertions are preserved. Production source and package/configuration files are unchanged by this correction.

## Reproduce

From `backend`, using the repository lockfile and unchanged Jest configuration:

```bash
npm ci --no-audit --no-fund
npm test -- --config jest.config.cjs --runInBand --runTestsByPath src/services/__tests__/contractEventIndexer.test.ts --json --outputFile="$RUNNER_TEMP/payd632-evidence/jest-results.json"
```

Create the output directory first when reproducing outside the workflow.

Execution used a standard public Ubuntu 24.04 runner, Node `v22.23.3`, npm `10.9.9`, Jest `30.2.0`, ts-jest `29.4.12`, TypeScript `5.9.3`, and Stellar SDK `12.3.0`. No tracked source diff remained during execution. Existing RPC/database mocks were retained; no live RPC or PostgreSQL service was used. This evidence covers one maintained Jest file. It does not cover the full suite or typecheck; the repository configuration retains `diagnostics: false`.

## Executed and published input blobs

| Input | Git blob |
| --- | --- |
| `backend/src/services/contractEventIndexer.ts` | `0e6260626b2869e1f1f128dd98a9662eb94456af` |
| `backend/src/services/__tests__/contractEventIndexer.test.ts` | `462c3b2af62615bca67e47453cd47a21f3e97d21` |
| `backend/src/types/contractEvent.ts` | `f561a78d6a73d20a6aae554f6a89737f69436d13` |
| `backend/jest.config.cjs` | `7b6e52a7558480442e1b9e160ea523b9f165e72c` |
| `backend/tsconfig.json` | `9bcf755fb55656c2454fa6bc097e562da91cc383` |
| `backend/package.json` | `746a535b08bf0c6ce9c4a96f7d75c76e0bbacb95` |
| `backend/package-lock.json` | `2803b2048d296fadbd21baae3ad89b660226cd47` |

The later report-only commit does not change these selected inputs.
