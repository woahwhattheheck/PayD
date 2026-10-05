# CodeRabbit review setup

The repository-side configuration is stored in `.coderabbit.yaml`.

It enables automatic and incremental pull-request review across all base branches,
including draft pull requests. TypeScript review is backed by ESLint, Rust review
by Clippy, and GitHub Actions files by Actionlint. Generated dependency and build
artifacts are excluded from review noise.

## One-time administration

A repository or organization administrator must install the CodeRabbit GitHub App
for `Protocol-Guild/PayD` and grant it access to pull requests and repository
contents. Once the app has access, CodeRabbit reads the checked-in configuration
automatically.

Documentation: https://docs.coderabbit.ai/

No custom webhook is required.

## Verification

After installation:

1. Open or update a pull request against any PayD base branch.
2. Confirm an automatic review starts without an explicit mention.
3. Push a follow-up commit and confirm an incremental review runs.
4. Confirm the review status and high-level summary are posted.
5. For TypeScript or Rust changes, confirm the matching static analysis runs when
   CodeRabbit does not detect an equivalent repository check.

If an equivalent linter already runs in repository CI, CodeRabbit may skip its
duplicate tool execution while still performing the pull-request review.
