import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../src/db/migrations');
const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
const seen = new Map();
const duplicates = [];
const invalid = [];

for (const filename of files) {
  const match = /^(\d+)_/.exec(filename);
  if (!match) {
    invalid.push(filename);
    continue;
  }
  const prefix = match[1];
  const previous = seen.get(prefix);
  if (previous) duplicates.push([prefix, previous, filename]);
  else seen.set(prefix, filename);
}

if (invalid.length || duplicates.length) {
  for (const filename of invalid) console.error(`Invalid migration filename (missing numeric prefix): ${filename}`);
  for (const [prefix, first, second] of duplicates) console.error(`Duplicate migration prefix ${prefix}: ${first}, ${second}`);
  process.exit(1);
}

console.log(`Migration prefix check passed: ${files.length} files, ${seen.size} unique prefixes.`);
