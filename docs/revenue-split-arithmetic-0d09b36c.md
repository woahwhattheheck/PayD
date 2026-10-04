# Revenue split arithmetic validation — 2026-10-04

Product source: `0d09b36c2e732d372ebdf484d9b7c31f4f139933`.
Baseline: `e04c31bd6e594b24b4bcb7c56c5a2132e1e43921`.
Existing submission: [Protocol-Guild/PayD PR 636](https://github.com/Protocol-Guild/PayD/pull/636), issue 515.

## Executed result

[Native replay run 37190079744](https://github.com/woahwhattheheck/PayD/actions/runs/37190079744), job `111400243183`, completed successfully. The command below ran the actual contract and Soroban token implementation, with synthetic balances and the repository's existing authentication mocks:

```sh
cargo test --locked -p revenue_split --lib
```

Result: **15 passed, 0 failed, 0 ignored, 0 filtered out**, reported test time **0.07 s**. This comprises all 12 existing package tests, unchanged, plus three arithmetic regressions. This is a correctness result, not a performance benchmark.

| Regression | Original implementation | Repaired implementation |
| --- | --- | --- |
| Overflowing share total at initialization | Accepted `[u32::MAX, 10001]`: `Ok(Ok(()))`; regression failed, exit 101 | Returns `SharesMustSumToTotal`; subsequent valid initialization succeeds |
| Overflowing share total at update | Accepted the invalid split: `Ok(Ok(()))`; regression failed, exit 101 | Rejects update; subsequent distribution retains the prior 50/50 balances |
| Large positive distribution, `i128::MAX / 2`, 60/40 split | Returns `Err(Err(Abort))`; regression failed, exit 101 | Correct sender/recipient balances and exactly one event with the correct asset, total, count and split weights |

Baseline execution used the original `lib.rs` plus only the test-module declaration, with the same new regression file. Each case ran separately with `--exact --nocapture`; all three reached execution and failed their assertions. The workflow then restored and hash-checked the exact repaired production file and ran all 15 tests. The lockfile and existing test source remained unchanged.

## Repair

Share totals use checked addition instead of modular addition. Non-final recipient amounts use the exact identity

```text
floor(amount * weight / 10000)
= (amount / 10000) * weight + floor((amount % 10000) * weight / 10000)
```

For positive amounts and validated weights in `0..=10000`, both intermediates and their sum fit within the input amount. Final-recipient remainder handling and the event schema are unchanged.

## Runtime and provenance

Ubuntu 24.04.5, x86_64; Rust 1.89.0 (`29483883e`), Cargo 1.89.0; locked Soroban SDK 23.5.2 and host 23.0.1. The repository's pinned toolchain and Cargo.lock were used; no dependency changes were made. Compilation of the test target took 58.25 s, separately from the test-execution time above.

Git blob identities:

- Production `lib.rs`: `9a9540dee5ffc07b251e2f335d1dcbd44ab82159`.
- New `arithmetic_test.rs`: `cd82526f8a19ff019886003617f9dc83e3bd9cf8`.
- Unchanged `test.rs`: `3e15a0202d13cce144d3ac00bcf14287373e1d17`.
- Unchanged `Cargo.lock`: `927dac874854b3fb1fb4fd697b479d2b2fcdbbbc`.

Replay workflow source: `777ff7d754ee15a72df6801833ccd1ad93596c6d` on the separate `validation/payd-636-arithmetic-rivet76f4-20261004` branch. It has read-only repository permission, no deployment step, and is not part of the product change. Logs were uploaded as artifact `11297804221`, SHA256 `fb3dc829be1d36997de0d27792886db5fdac4f90abbcc489c1086f247d499dd3`, with one-day artifact retention; the run log also contains the results.

The first attempt, run 37189908720, stopped at compilation because the new test compared raw SDK `Val` objects. The test-only correction compares typed `Symbol` values; no successful runtime result is attributed to that first attempt.

## Limits

This does not claim a full-workspace build, WASM deployment, live-chain transaction, indexer integration, maintainer acceptance or reward payment. Existing unrelated workflow failures are not declared green by this focused replay. In particular, the inherited `contract-release.yml` still contains unsupported workflow-root `retention-days`; its tag-release behavior was not exercised or changed here.
