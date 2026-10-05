# PayD CSV differential evidence

These scripts reproduce the completed parser and backend-validation comparisons against a supplied PayD checkout. They preserve 48 parser fixtures and 73 backend fixtures, including each BOM, quote, CR/LF, whitespace and blank-record byte sequence. The existing implementation and PR attribution to Nacre/Kestrel remain unchanged.

The historical JSON receipts in `observed/` were collected at `bec05631342cd795b2bed626f2449a3b3006f7c0` using Node `v24.19.0`. They are observations from the original completed scripts, not results from rerunning these portable wrappers. The original parser comparison found **32 identical record sets, 8 shared file rejections and 8 differences**. The actual backend comparison found **15 preview-count mismatches across 73 fixtures**. All 8 backend parser rejections recorded zero employee creates, including a valid prefix followed by malformed or excess columns. Logical row numbering remains 3 for an invalid employee following a multiline quoted first record.

## Reproduce

Use Node 24.19.0 and place dependencies in a separate npm prefix. No dependency install or lockfile change is needed in the product checkout.

```sh
mkdir -p /tmp/payd685-csv-dependencies
npm install --prefix /tmp/payd685-csv-dependencies --ignore-scripts --no-audit --no-fund --save-exact fast-csv@5.0.5 zod@4.3.6 @stellar/stellar-sdk@12.3.0 typescript@5.9.3
node fixtures.mjs --out /tmp/payd685-csv-fixtures
node parser-differential.mjs --checkout /absolute/path/to/payd --dependencies /tmp/payd685-csv-dependencies --out /tmp/payd685-csv-results
node backend-validation.mjs --checkout /absolute/path/to/payd --dependencies /tmp/payd685-csv-dependencies --out /tmp/payd685-csv-results
```

Run the commands from this evidence directory, or supply absolute script paths. Optionally append `--expected-sha <full-commit>` to guard a particular checkout. The scripts also accept `PAYD_CSV_CHECKOUT`, `PAYD_CSV_DEPENDENCIES`, `PAYD_CSV_OUTPUT` and optional `PAYD_CSV_EXPECTED_SHA` instead of their corresponding flags.

The generator writes all 73 synthetic CSV files and a manifest containing byte counts, SHA-256 hashes and escaped content. The parser script writes the 48-case raw files, manifest and `parser/differential.json`; the backend script writes the 73-case raw files, manifest and `backend/backend-validation.json`. Each script records checkout HEAD, worktree status, targeted source hashes, runtime and dependency versions. Source imports and dependency resolution use the supplied roots rather than workspace-specific paths.

## What the checks establish

`parser-differential.mjs` calls the real locked `fast-csv.parseStream(Readable.from(content), { headers: true })` and the actual checkout preview function. It records differences in file acceptance, record values and logical row numbers. Missing required headers can intentionally produce a frontend file error while the backend parser accepts the structure and later rejects rows.

`backend-validation.mjs` loads the actual checkout `CsvPayrollImportService` and employee schema with the locked parser, Zod and Stellar SDK. TypeScript transpilation removes type-only imports without changing product source. Only the database pool, employee persistence service and logger are replaced by in-memory recording stubs. Assertions verify raw-byte round trips, zero recorded creates after parser rejection and agreement between backend success counts and recorded employee creates. The frontend email and salary validator functions are a documented snapshot from `EmployeeList`, with that source file hashed for review.

**Exit code 0 means collection and those narrow assertions completed. It does not mean the parsers, validators, API or database agree.** The output explicitly retains mismatches and uses `completed-with-observed-mismatches` when they are present. The receipts include accepted employee values, so coercions such as `0x10` to salary `0` remain visible even when counts agree.

## Current API limits

CSV import submits the original decoded file content and treats server results as authoritative; preview readiness is provisional. Frontend validation omits the backend's wallet and length checks, uses a looser email rule and `Number` salary conversion, while the backend uses `parseFloat`, so ready counts and stored salary values can differ. Parser acceptance also differs for unquoted literal quotes, repeated empty headers and whitespace-only rows. The UI currently shows server summary counts rather than per-row rejection reasons. These checks use in-memory persistence stubs and establish parser/schema behavior; actual database uniqueness, transaction failures, authentication and live API integration remain outside this evidence.
