# PayD PR 627: required contract build passed

Operation: `PAYD627-CONTRACT-BUILD-E267`  
Executor: GPT-6 Astra Pro, `throughput_gap`, ChatGPT cloud `e267d73fede7`  
Execution date: 2026-10-04 UTC

The existing contribution [PR 627](https://github.com/Protocol-Guild/PayD/pull/627)
satisfies the contract-build acceptance criterion in [issue 524](https://github.com/Protocol-Guild/PayD/issues/524).
The remaining production Cargo workspace compiled successfully at original source
commit `6a7625345c501df219ce1e777224fbd0f3c87359`. No product source repair was needed.

## Actual execution

- [GitHub Actions run 37192658546](https://github.com/woahwhattheheck/PayD/actions/runs/37192658546), [job 111407944232](https://github.com/woahwhattheheck/PayD/actions/runs/37192658546/job/111407944232): success.
- Standard public `ubuntu-latest` runner; Rust and Cargo `1.89.0`, matching `rust-toolchain.toml`.
- One release build with the existing locked dependency graph and `wasm32v1-none` target.
- Compiler exit **0**. Cargo reported **36.01 seconds**; the wrapper recorded **36 whole seconds**.
- Four production Wasm files were produced. The shared `common` crate also compiled.
- The post-build `git diff --exit-code` step succeeded.

```bash
rustup toolchain install 1.89.0 --profile minimal --target wasm32v1-none
cargo +1.89.0 build --locked --release --workspace --target wasm32v1-none
```

The full compiler output is retained in [build.log](build.log), with the original
exit value, elapsed seconds, environment, command and input hashes beside it.

| Compiled module | Bytes | SHA-256 |
| --- | ---: | --- |
| `bulk_payment.wasm` | 18,641 | `d4ec532c0e16c1f38c5345224adea467937dc6af4f98eb65b893ecf1a083e413` |
| `cross_asset_payment.wasm` | 18,560 | `81479faecab937b1e425b857347d29257935b6d5cd39246539f5452658ed30a3` |
| `revenue_split.wasm` | 18,956 | `8c75a057c6dca432f3b778d8f5c4efc21f4937c2c3397815483296bee57615f6` |
| `vesting_escrow.wasm` | 26,846 | `a2efbfc6d1efa48bc24a6bb0290f3c977e7d7de5849ad2bccf7d6f36e5c739c3` |

## Acceptance and remaining scope

The executed source checks confirmed that `hello_world` is absent from Cargo
workspace members, the lockfile package list, and `contracts/hello_world/`.
The deleted scaffold was not retained, so the conditional template README
criterion does not apply. All five remaining workspace members compiled.

One existing warning remains in `contracts/revenue_split/src/lib.rs:130`:
`Events::publish` is deprecated in favor of `#[contractevent]`. It did not fail
the build and was outside this deletion's scope.

This run checks the requested production contract build. It does not establish
application test coverage, deployment behavior, sponsor acceptance or payment.
The issue remains labeled `Maybe Rewarded`; no fixed award is reported here.

## Evidence and source custody

The source was checked out explicitly at `6a7625345c501df219ce1e777224fbd0f3c87359`.
The original `type/payd-524-hello-world` contribution branch remained at that
commit in the final live PR read. The validation workflow exists only on
`validation/payd627-contract-build-e267-20261004`, executed at
`5b9ea480adf8879ad59dff9123461a0954658662`. Its seed removed inherited workflows
from the validation branch to keep execution to one requested build.
Do not merge this auxiliary validation branch into the product branch.

[Artifact 11300060446](https://github.com/woahwhattheheck/PayD/actions/runs/37192658546/artifacts/11300060446)
contains the original source archive, logs and compiled Wasm modules. Its ZIP is
1,084,030 bytes and SHA-256
`f34730d434b580b4aa29953b69a224d7707ac99268cde032116e31927ac25ddf`;
the downloaded bytes matched the provider digest. GitHub reports artifact
expiration on 2026-10-11. The text build evidence is also retained in this Git
commit so the result remains reviewable after artifact expiration.
