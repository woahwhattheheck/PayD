# CSV import browser and backend evidence

Operation: `PAYD685-CSV-REAL-INTERFACE-20261005`, continuing the existing PayD #685 carrier and preserving its Kestrel/Nacre source attribution.

## Mounted import feedback

Product commit `9d01aa6961e96be78d006ed4bc2a2b7785a2bb5b` changes only `EmployeeEntry.tsx`: the employee refresh after a successful bulk import updates the list without replacing `EmployeeList` with the foreground spinner. Initial loading and refresh after a single employee is added keep their existing behavior. The awaited refresh, request payload, authentication interceptor, selection guards and backend contracts are preserved.

The exact parent `bec05631342cd795b2bed626f2449a3b3006f7c0` fails the same real-browser assertion **after** the refresh GET completes: the expected `Imported 25 of 25 rows.` summary never appears. The fixed source passes all eight browser cases. [before.json](https://github.com/woahwhattheheck/PayD/blob/8ee71e238d1a7e538e51f7513e56934f967698d8/frontend/tests/csv-import-evidence/before.json) and [after.json](https://github.com/woahwhattheheck/PayD/blob/8ee71e238d1a7e538e51f7513e56934f967698d8/frontend/tests/csv-import-evidence/after.json) pin the actual source-file SHA-256 values, runtime and observed result; screenshots show the actual application.

Actual runtime: Node 24.19.0, Chrome Headless Shell 151.0.7922.34, React and Vite from the unchanged frontend lockfile. Both parent and fixed source pass the full `npm run build` (`tsc -b && vite build`, 2,817 modules); the existing large-chunk warning remains. The eight existing CSV parser tests also pass.

```sh
cd frontend
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node --test tests/csvPreview.test.mjs
npx playwright install chromium
PAYD_EVIDENCE_DIR=/tmp/payd-csv-browser node tests/csvImport.browser.mjs
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an already installed Chromium executable. Run with ports 4000 and 5173 free. The harness closes its owned browser and servers in `finally`.

The browser loads the real `/employee` app, React components, `FileReader`, and Axios interceptor. Its only backend is an explicitly labeled loopback HTTP fixture, with a dummy token and no database. Public network requests are blocked. Cases cover:

- File selection with quoted commas and multiline fields; exactly 20 of 25 rows previewed.
- Exactly one initial authenticated request with the unmodified CSV string.
- Successful and partial-response summaries surviving the awaited employee refresh.
- HTTP 400 preserving a retryable preview.
- Replacement selection suppressing old feedback; closing the preview retaining progress.
- Mobile 390 × 844 drag/drop through a real `DataTransfer`, `File`, and `FileReader`.

The complete run makes five deliberately controlled import requests across those cases. It does not execute a live employee import, database transaction, signing or payment, or prove the entire application's behavior.

## Actual backend differentials

[parser-differential.json](https://github.com/woahwhattheheck/PayD/blob/8ee71e238d1a7e538e51f7513e56934f967698d8/frontend/tests/csv-import-evidence/parser-differential.json) records 48 preserved raw-byte fixtures against real `fast-csv` 5.0.5 with the backend's `{ headers: true }` options: 32 identical records and logical row numbers, eight shared file rejections, and eight differences. BOM, quoted headers/cells, commas, doubled quotes, multiline fields, CR/LF/CRLF, ordinary blank lines and short rows are represented. Differences include backend acceptance of unquoted internal quote characters, repeated empty headers, and differences for whitespace-only rows and `__proto__` extra headers. Missing required headers are rejected by the preview before backend row validation. Universal parser parity is **not** claimed.

[backend-validation.json](https://github.com/woahwhattheheck/PayD/blob/8ee71e238d1a7e538e51f7513e56934f967698d8/frontend/tests/csv-import-evidence/backend-validation.json) records 73 cases against the actual `processCsv` and employee schema, using locked fast-csv 5.0.5, Zod 4.3.6, Stellar SDK 12.3.0 and TypeScript 5.9.3. Only the database pool, employee persistence and logger are replaced with in-memory recording stubs. There are 15 differences between preview-valid counts and actual backend success counts, including wallet/length/email constraints and salary parsing. Malformed complete files cause zero recorded employee creates, and errors after multiline records keep logical row numbering.

These model checks ran on parent `bec0563`. The parser, preview validators, backend importer and employee schema are unchanged by the mounted-feedback fix, so their source hashes remain valid. Preview validity remains provisional; backend validation controls acceptance. Salary coercion and other schema differences are recorded findings, not represented as fixed by this lifecycle patch. A separate source lane is examining strict salary parsing.

The JSON records preserve actual failures and mismatches. They establish neither a live database outcome nor a full backend suite, hosted CI, sponsor acceptance, reward or payment.

Full [desktop screenshot](https://github.com/woahwhattheheck/PayD/blob/8ee71e238d1a7e538e51f7513e56934f967698d8/frontend/tests/csv-import-evidence/desktop-after-refresh.png), [mobile screenshot](https://github.com/woahwhattheheck/PayD/blob/8ee71e238d1a7e538e51f7513e56934f967698d8/frontend/tests/csv-import-evidence/mobile-drop-preview.png), [baseline screenshot](https://github.com/woahwhattheheck/PayD/blob/8ee71e238d1a7e538e51f7513e56934f967698d8/frontend/tests/csv-import-evidence/before-after-refresh.png), and [portable backend reproduction instructions](https://github.com/woahwhattheheck/PayD/blob/8ee71e238d1a7e538e51f7513e56934f967698d8/frontend/tests/csv-import-evidence/reproduce/README.md) are retained on the isolated evidence commit. The feature branch carries this compact receipt and the real-browser regression harness.
