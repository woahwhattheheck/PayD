import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const exactDependencies = {
  'fast-csv': '5.0.5',
  zod: '4.3.6',
  '@stellar/stellar-sdk': '12.3.0',
  typescript: '5.9.3',
};
export const sourceFiles = [
  'frontend/src/utils/csvPreview.ts',
  'frontend/src/components/EmployeeList.tsx',
  'backend/src/services/csvPayrollImportService.ts',
  'backend/src/schemas/employeeSchema.ts',
];

export function configuration(mode) {
  const args = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!['--checkout', '--dependencies', '--out', '--expected-sha'].includes(key) || !value) {
      throw new Error('Usage: node <script>.mjs --checkout /path/to/checkout --dependencies /path/to/isolated/npm-prefix --out /path/to/results [--expected-sha <commit>]');
    }
    args[key.slice(2)] = value;
  }
  const checkout = args.checkout || process.env.PAYD_CSV_CHECKOUT;
  const dependencies = args.dependencies || process.env.PAYD_CSV_DEPENDENCIES;
  const output = args.out || process.env.PAYD_CSV_OUTPUT;
  const expectedSha = args['expected-sha'] || process.env.PAYD_CSV_EXPECTED_SHA;
  if (!checkout || !dependencies || !output) {
    throw new Error('Supply --checkout, --dependencies and --out, or PAYD_CSV_CHECKOUT/PAYD_CSV_DEPENDENCIES/PAYD_CSV_OUTPUT.');
  }
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Node 24 or newer is required; original observations used v24.19.0.');
  const sourceRoot = resolve(checkout);
  const dependencyDirectory = resolve(dependencies);
  const outputDirectory = join(resolve(output), mode);
  const sourceURL = relative => pathToFileURL(join(sourceRoot, relative) + (relative === '' ? sep : '')).href;
  for (const file of sourceFiles) {
    assert.ok(existsSync(join(sourceRoot, file)), 'Missing checkout source: ' + file);
  }
  const dependencyRequire = createRequire(pathToFileURL(join(dependencyDirectory, 'package.json')));
  const dependencyVersions = {};
  for (const [name, version] of Object.entries(exactDependencies)) {
    const manifest = JSON.parse(readFileSync(join(dependencyDirectory, 'node_modules', name, 'package.json'), 'utf8'));
    assert.equal(manifest.version, version, 'Dependency must match original backend lock: ' + name);
    dependencyVersions[name] = manifest.version;
  }
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:sourceRoot, encoding:'utf8'}).trim();
  if (expectedSha) assert.equal(sourceSha, expectedSha, 'Checkout commit differs from requested --expected-sha.');
  return {
    sourceRoot, sourceURL, sourceSha, dependencyDirectory, dependencyRequire,
    dependencyURL: name => pathToFileURL(dependencyRequire.resolve(name)).href,
    dependencyVersions, outputDirectory,
  };
}

export function sourceMetadata(config) {
  return {
    sourceSha: config.sourceSha,
    sourceWorkingTree: execFileSync('git', ['status', '--short'], {cwd:config.sourceRoot, encoding:'utf8'}).trim(),
    sourceFiles: Object.fromEntries(sourceFiles.map(file => [file,
      createHash('sha256').update(readFileSync(join(config.sourceRoot, file))).digest('hex')])),
    validatorScope: 'EmployeeList email and Number-based salary validator functions are snapshotted in fixtures.mjs from the observed source; their source is also hashed. Changes to those functions require updating the snapshot before claiming current-validator equivalence.',
  };
}
