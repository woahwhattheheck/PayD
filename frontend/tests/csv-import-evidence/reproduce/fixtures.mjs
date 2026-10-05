import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Synthetic employee inputs from the completed 48/73-case differential.
// This generator needs no external packages and preserves the exact UTF-8 bytes.
export const required = ['first_name', 'last_name', 'email'];
export const header = required.join(',');
export const good = 'Ada,Lovelace,ada@example.com';
export const validators = {
  email: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Invalid email address',
  base_salary: value => {
    if (!value) return null;
    const salary = Number(value);
    return Number.isFinite(salary) && salary >= 0 ? null : 'base_salary must be a non-negative number';
  },
};
export const parserCases = [
  ...['\n', '\r\n', '\r'].map((nl, i) => ({ name: ['ordinary-lf','ordinary-crlf','ordinary-cr'][i], content: [header, good, 'Grace,Hopper,grace@example.com', ''].join(nl) })),
  { name: 'quoted-bom-header', content: '\uFEFF"first_name","last_name","email"\r\n"Ada, Augusta","Love""lace",ada@example.com\r\n' },
  ...['\n','\r\n','\r'].map((nl,i) => ({ name: ['multiline-lf','multiline-crlf','multiline-cr'][i], content: `${header},position${nl}${good},"Lead,${nl}Researcher"${nl}Grace,Hopper,grace@example.com,Engineer` })),
  { name: 'unquoted-whitespace', content: `${header}\n Grace , Hopper ,grace@example.com` },
  { name: 'quoted-whitespace', content: `${header},position\n  "Ada"  ,Lovelace,ada@example.com,""` },
  { name: 'quoted-tabs', content: `${header}\n\t"Ada"\t,Lovelace,ada@example.com` },
  { name: 'quoted-nbsp', content: `${header}\n\u00a0"Ada"\u00a0,Lovelace,ada@example.com` },
  { name: 'quoted-formfeed', content: `${header}\n\f"Ada"\f,Lovelace,ada@example.com` },
  { name: 'blank-middle', content: `${header}\n${good}\n\nGrace,Hopper,grace@example.com` },
  { name: 'whitespace-only-middle', content: `${header}\n${good}\n  \t\nGrace,Hopper,grace@example.com` },
  { name: 'blank-only-row', content: `${header}\n\n` },
  { name: 'empty-fields-row', content: `${header}\n,,` },
  { name: 'short-row', content: `${header}\nAda,Lovelace` },
  { name: 'empty', content: '' },
  { name: 'bom-only', content: '\uFEFF' },
  { name: 'header-only', content: header },
  { name: 'header-terminator', content: `${header}\n` },
  { name: 'leading-blank', content: `\n${header}\n${good}` },
  { name: 'leading-whitespace-blank', content: `  \t\n${header}\n${good}` },
  { name: 'missing-header', content: `name,email\nAda,ada@example.com` },
  { name: 'whitespace-header', content: ` first_name,last_name,email\n${good}` },
  { name: 'duplicate-header', content: `${header},email\n${good},other@example.com` },
  { name: 'empty-header', content: `${header},\n${good},ignored` },
  { name: 'duplicate-empty-header', content: `${header},,\n${good},ignored,alsoignored` },
  { name: 'excess-row', content: `${header}\n${good},excess` },
  { name: 'excess-after-valid-prefix', content: `${header}\n${good}\nGrace,Hopper,grace@example.com,excess` },
  { name: 'unclosed-quote', content: `${header}\n"Ada,Lovelace,ada@example.com` },
  { name: 'unclosed-after-valid-prefix', content: `${header}\n${good}\n"Grace,Hopper,grace@example.com` },
  { name: 'suffix-after-quote', content: `${header}\n"Ada"x,Lovelace,ada@example.com` },
  { name: 'quote-inside-unquoted', content: `${header}\nA"da,Lovelace,ada@example.com` },
  { name: 'quote-after-unquoted-space', content: `${header}\nA "da",Lovelace,ada@example.com` },
  { name: 'unquoted-trailing-quote', content: `${header}\nAda",Lovelace,ada@example.com` },
  { name: 'escaped-quotes', content: `${header}\n"A""da",Lovelace,ada@example.com` },
  { name: 'triple-close-quote', content: `${header}\n"Ada""",Lovelace,ada@example.com` },
  { name: 'quote-after-newline', content: `${header}\n${good}\n"Grace",Hopper,grace@example.com` },
  { name: 'crlf-inside-multiline-logical-index', content: `${header},position\r\n${good},"A\r\nB"\r\nGrace,,invalid` },
  { name: 'empty-final-quoted', content: `${header},position\n${good},""` },
  { name: 'quoted-linebreak-last-field', content: `${header},position\n${good},"\n"` },
  { name: 'proto-header', content: `${header},__proto__\n${good},value` },
  { name: 'salary-decimal', content: `${header},base_salary\n${good},123.50` },
  { name: 'salary-junk-suffix', content: `${header},base_salary\n${good},123abc` },
  { name: 'salary-hex', content: `${header},base_salary\n${good},0x10` },
  { name: 'salary-infinity', content: `${header},base_salary\n${good},Infinity` },
  { name: 'salary-whitespace', content: `${header},base_salary\n${good},  ` },
];

export const validWallet = 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR';
export const validationExtraCases = [
  {name:'valid-wallet', content:`${header},wallet_address\n${good},${validWallet}`},
  {name:'invalid-wallet', content:`${header},wallet_address\n${good},INVALID`},
  ...['first_name','last_name','position','department'].map(field => ({
    name:`overlong-${field}`, content: field === 'first_name' ? `${header}\n${'A'.repeat(101)},Lovelace,ada@example.com` : field === 'last_name' ? `${header}\nAda,${'L'.repeat(101)},ada@example.com` : `${header},${field}\n${good},${'A'.repeat(101)}`,
  })),
  {name:'overlong-currency', content:`${header},base_currency\n${good},${'A'.repeat(13)}`},
  ...['a@b.c','.a@example.com','a..b@example.com','ada@example.com','ada+pay@example.com'].map((email,i) => ({name:`email-validation-${i}`,content:`${header}\nAda,Lovelace,${email}`})),
  ...[' ','0x10','1000USD','Infinity','NaN','-1','0','0.25','1e3','1_000','0b10'].map((salary,i) => ({name:`salary-validation-${i}`,content:`${header},base_salary\n${good},${salary}`})),
  {name:'mixed-valid-and-invalid-wallet', content:`${header},wallet_address\n${good},${validWallet}\nGrace,Hopper,grace@example.com,INVALID`},
  {name:'multiline-first-then-invalid-email',content:`${header},position\r\n${good},"Lead\r\nResearcher"\r\nGrace,Hopper,invalid,Engineer`},
];

export const backendCases = [...parserCases, ...validationExtraCases];
assert.equal(parserCases.length, 48);
assert.equal(backendCases.length, 73);
assert.equal(new Set(backendCases.map(item => item.name)).size, backendCases.length);

export async function writeFixtures(cases, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const manifest = [];
  for (const item of cases) {
    const raw = Buffer.from(item.content, 'utf8');
    const file = item.name + '.csv';
    await writeFile(join(outputDirectory, file), raw);
    const reloaded = await readFile(join(outputDirectory, file));
    assert.deepEqual(reloaded, raw, item.name + ': raw bytes were preserved');
    manifest.push({ name: item.name, file, rawBytes: raw.length,
      rawSha256: createHash('sha256').update(raw).digest('hex'),
      contentJSON: JSON.stringify(item.content) });
  }
  await writeFile(join(outputDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const index = args.indexOf('--out');
  if (index < 0 || !args[index + 1]) throw new Error('Usage: node fixtures.mjs --out /absolute/output');
  const outputDirectory = resolve(args[index + 1]);
  const manifest = await writeFixtures(backendCases, outputDirectory);
  console.log(JSON.stringify({ total: manifest.length, outputDirectory }, null, 2));
}
