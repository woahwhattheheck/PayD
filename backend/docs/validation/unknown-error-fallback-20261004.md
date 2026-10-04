# Unknown-error response fallback — 2026-10-04

Continuation of Protocol-Guild/PayD #621 for issue #550, based on commit
`4f0b467d6bb2fc5622a83b3467baebf21054d425`.

## Change

A thrown JavaScript value need not be an Error or support string conversion.
Previously, `String(err)` could throw before the global middleware logged the
failure or returned its standard JSON response. Null-prototype objects and
objects whose `toString` or `Symbol.toPrimitive` throws now use the existing
`An error occurred` fallback. Ordinary Error messages, valid string conversion,
typed errors, parser mappings, request IDs and headers-sent delegation are
unchanged. Conversion failures do not expose the secondary exception or stack,
including in development.

Three factory rows were added to the existing errorHandler Jest file. Each
exercises production and development, checks the exact 500 response and logged
fallback, and confirms that next is not called.

## Execution

Node v22.16.0 and TypeScript 5.8.3. The exported production middleware and the
unchanged AppError classes were transpiled to CommonJS with TypeScript's
transpileModule and executed with injected config, logger, response and next
adapters. This was a direct module execution, not a rewritten handler.

| Case group | Before | After |
| --- | --- | --- |
| Null-prototype, throwing toString and throwing Symbol.toPrimitive, each in production/development | 6 conversion exceptions; no JSON response | 6 exact standard 500 responses |
| Ordinary Error and ordinary string, each in production/development | 4 pass | 4 pass |
| Typed NotFoundError, recognized JSON parser error and headers-sent delegation | 3 pass | 3 pass |
| Total direct-handler cases | 7 pass, 6 fail | 13 pass, 0 fail |

Before source blob: `af5019c390d451233265492c452ee32408b7311c`.
After source blob: `dfd467c4ad672a65fd5b09f758ca99a441ff7b00`.
Both retrieved preimage files were verified against their native Git blob IDs
before editing. Existing regression cases were preserved.

## Limits

The cloud container could not resolve github.com for a checkout or fetch
project dependencies. No Express HTTP integration run, full Jest run, complete
typecheck, production performance measurement, hosted CI result or sponsor
acceptance is claimed here. The maintained Jest regression additions are
published but were not executed under Jest in this environment. TypeScript
transpilation of the changed source and regression file reported no syntax
errors; transpilation is not a typecheck.

The existing PR and claimant are retained. This change does not establish an
award or payment.
