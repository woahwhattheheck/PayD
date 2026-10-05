import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { parserCases as cases, required, validators, writeFixtures } from './fixtures.mjs';
import { configuration, sourceMetadata } from './runtime.mjs';

const config = configuration('parser');
const csv = config.dependencyRequire('fast-csv');
const { parseCSVPreview } = await import(config.sourceURL('frontend/src/utils/csvPreview.ts'));
const outDir = config.outputDirectory;
const manifest = await writeFixtures(cases, outDir);

async function parseBackend(content) {
  return await new Promise(resolve => {
    const rows = [];
    const parser = csv.parseStream(Readable.from(content), { headers: true });
    parser.on('data', row => rows.push({ rowNumber: rows.length + 2, data: row }));
    parser.on('error', error => resolve({ accepted: false, error: error.message, rowsBeforeError: rows }));
    parser.on('end', rowCount => resolve({ accepted: true, parserRowCount: rowCount, rows }));
  });
}
function parseFrontend(content) {
  try {
    const rows = parseCSVPreview(content, required, validators);
    return { accepted: true, rows, validCount: rows.filter(row => row.isValid).length };
  } catch (error) {
    return { accepted: false, error: error.message };
  }
}

const results = [];
for (let index = 0; index < cases.length; index++) {
  const testCase = cases[index];
  const saved = manifest[index];
  const raw = Buffer.from(testCase.content, 'utf8');
  const reloaded = await readFile(join(outDir, saved.file));
  assert.deepEqual(reloaded, raw, `${testCase.name}: preserved raw bytes`);
  const content = reloaded.toString('utf8');
  const backend = await parseBackend(content);
  const frontend = parseFrontend(content);
  let comparison = frontend.accepted === backend.accepted ? 'same-acceptance' : 'different-acceptance';
  if (frontend.accepted && backend.accepted) {
    try {
      assert.deepEqual(frontend.rows.map(({rowNumber,data}) => ({rowNumber,data})), backend.rows);
      comparison = 'same-records';
    } catch { comparison = 'different-records'; }
  }
  results.push({ ...saved, frontend, backend, comparison });
}
const summary = {
  total: results.length,
  sameRecords: results.filter(x => x.comparison === 'same-records').length,
  bothReject: results.filter(x => !x.frontend.accepted && !x.backend.accepted).length,
  differences: results.filter(x => x.comparison.startsWith('different')).map(x => ({name:x.name, comparison:x.comparison, frontend:x.frontend, backend:x.backend})),
};
const evidence = {
  ...sourceMetadata(config), node: process.version,
  dependencies: config.dependencyVersions, backendOptions: {headers:true},
  status: summary.differences.length ? 'completed-with-observed-mismatches' : 'completed-without-observed-parser-mismatches',
  compareScope: 'Real backend parseStream versus actual preview parser; no employee/database writes or live calls. Backend validation is not executed in this parser differential. Exit zero records successful collection, not parser equivalence.',
  summary, cases: results,
};
await writeFile(join(outDir, 'differential.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({status:evidence.status, ...summary}, null, 2));
