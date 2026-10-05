// From frontend/: node --experimental-strip-types --test tests/csvPreview.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCSVPreview } from '../src/utils/csvPreview.ts';

const required = ['first_name', 'last_name', 'email'];
const header = required.join(',');
const validators = {
  email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Invalid email address',
};

test('ordinary LF, CRLF and CR records retain validation and logical row numbers', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const rows = parseCSVPreview(
      [header, 'Ada,Lovelace,ada@example.com', 'Grace,,invalid', ''].join(newline),
      required,
      validators
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].isValid, true);
    assert.equal(rows[1].rowNumber, 3);
    assert.deepEqual(rows[1].errors, ['Missing required field: last_name', 'Invalid email address']);
  }
});

test('BOM, quoted headers, embedded commas and escaped quotes map to the right fields', () => {
  const [row] = parseCSVPreview(
    '\uFEFF"first_name","last_name","email"\r\n"Ada, Augusta","Love""lace",ada@example.com\r\n',
    required,
    validators
  );
  assert.deepEqual(row.data, {
    first_name: 'Ada, Augusta', last_name: 'Love"lace', email: 'ada@example.com',
  });
  assert.equal(row.isValid, true);
});

test('multiline quoted values are one record and whitespace is not trimmed', () => {
  const rows = parseCSVPreview(
    `${header},position\r\nAda,Lovelace,ada@example.com,"Lead,\r\nResearcher"\r\n Grace , Hopper ,grace@example.com,Engineer`,
    required,
    validators
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].data.position, 'Lead,\r\nResearcher');
  assert.equal(rows[1].rowNumber, 3);
  assert.equal(rows[1].data.first_name, ' Grace ');
  assert.equal(rows[1].data.last_name, ' Hopper ');
});

test('empty/header-only files do not produce data, and shorter rows pad empty fields', () => {
  assert.deepEqual(parseCSVPreview('', required), []);
  assert.deepEqual(parseCSVPreview('\uFEFF', required), []);
  assert.deepEqual(parseCSVPreview(`${header}\n`, required), []);
  const rows = parseCSVPreview(`${header}\nAda,Lovelace\n,,`, required);
  assert.equal(rows[0].data.email, '');
  assert.equal(rows[0].isValid, false);
  assert.equal(rows[1].errors.length, 3);
});

test('malformed quotes reject the complete file instead of publishing a valid prefix', () => {
  for (const badRow of ['"Ada,Lovelace,ada@example.com', '"Ada"x,Lovelace,ada@example.com', 'A"da,Lovelace,ada@example.com']) {
    assert.throws(
      () => parseCSVPreview(`${header}\nGrace,Hopper,grace@example.com\n${badRow}`, required),
      /Invalid CSV:/
    );
  }
});

test('missing/duplicate headers and excess columns cannot appear importable', () => {
  assert.throws(() => parseCSVPreview('name,email\nAda,a@example.com', required), /Missing required columns:/);
  assert.throws(() => parseCSVPreview(`${header},email\nAda,Lovelace,a@example.com,b@example.com`, required), /duplicate column headers/);
  assert.throws(() => parseCSVPreview(`${header}\nAda,Lovelace,a@example.com,extra`, required), /too many columns in row 2/);
  assert.throws(() => parseCSVPreview(` first_name,last_name,email\nAda,Lovelace,a@example.com`, required), /Missing required columns: first_name/);
});

test('whitespace around quoted fields and a final quoted empty cell are handled', () => {
  const [row] = parseCSVPreview(`${header},position\n  "Ada"  ,Lovelace,ada@example.com,""`, required);
  assert.equal(row.data.first_name, 'Ada');
  assert.equal(row.data.position, '');
  assert.equal(row.isValid, true);
});

test('all 1000 records are validated although the component previews only the first 20', () => {
  const content = `${header}\n${Array.from({ length: 1000 }, (_, i) => `"Employee, ${i}",Example,user${i}@example.com`).join('\n')}`;
  const rows = parseCSVPreview(content, required, validators);
  assert.equal(rows.length, 1000);
  assert.equal(rows.at(-1).rowNumber, 1001);
  assert.equal(rows.at(-1).data.first_name, 'Employee, 999');
  assert.equal(rows.every((row) => row.isValid), true);
});
