import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Fails if two migration files share a numeric prefix (#456). Numeric
// prefixes define the documented strict execution order; a duplicate makes
// order depend on accidental alphabetical tie-breaking.
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');

const seen = new Map();
let bad = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  const m = file.match(/^(\d+)_/);
  if (!m) {
    console.error(`[migrations] missing numeric prefix: ${file}`);
    bad++;
    continue;
  }
  if (seen.has(m[1])) {
    console.error(`[migrations] duplicate prefix ${m[1]}: ${seen.get(m[1])} and ${file}`);
    bad++;
  } else {
    seen.set(m[1], file);
  }
}
if (bad > 0) process.exit(1);
console.log(`[migrations] OK - ${seen.size} migration file(s), all prefixes unique`);
