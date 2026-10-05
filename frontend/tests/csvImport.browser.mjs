import { createServer as createHttpServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
process.chdir(root);
const evidence = process.env.PAYD_EVIDENCE_DIR || '/tmp/payd685-browser-before';
await mkdir(evidence, { recursive: true });
const csv =
  'first_name,last_name,email,base_salary\r\n' +
  Array.from(
    { length: 25 },
    (_, i) => `"Ada, ${i}","Lovelace\nByron",ada${i}@example.test,100`
  ).join('\r\n') +
  '\r\n';
const requests = [];
const errors = [];
let listReads = 0;
let mode = 'success';
let releaseImport;
const api = createHttpServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5173');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  requests.push({
    method: req.method,
    path: req.url,
    authorization: req.headers.authorization,
    body,
  });
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/employees' && req.method === 'GET') {
    listReads++;
    if (listReads > 1) await new Promise((resolve) => setTimeout(resolve, 150));
    res.end(JSON.stringify({ data: [] }));
  } else if (req.url === '/api/employees/bulk-import' && req.method === 'POST') {
    const requestMode = mode;
    await new Promise((resolve) => {
      releaseImport = resolve;
    });
    releaseImport = undefined;
    if (requestMode === 'error') {
      res.statusCode = 400;
      res.end(JSON.stringify({ message: 'Fixture import rejected' }));
    } else {
      res.end(
        JSON.stringify({
          message: 'Fixture transport only',
          summary: {
            totalRows: 25,
            successCount: requestMode === 'partial' ? 24 : 25,
            errorCount: requestMode === 'partial' ? 1 : 0,
          },
          errors:
            requestMode === 'partial'
              ? [{ row: 3, email: 'ada1@example.test', errors: ['Fixture rejected row'] }]
              : [],
        })
      );
    }
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'No live service in this fixture' }));
  }
});
await new Promise((resolve, reject) => {
  api.once('error', reject);
  api.listen(4000, '127.0.0.1', resolve);
});
const vite = await createServer({
  root,
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
    headless: true,
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.protocol === 'data:' ||
      url.protocol === 'blob:'
    )
      return route.continue();
    return route.abort();
  });
  await context.addInitScript(() =>
    localStorage.setItem('payd_auth_token', 'fixture-only-no-credentials')
  );
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/employee', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page
    .getByRole('button', { name: 'Import from CSV', exact: true })
    .click({ timeout: 60000 });
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'quoted-employees.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
  await page.getByText('Showing first 20 of 25 rows', { exact: true }).waitFor();
  const previewTable = page
    .locator('table')
    .filter({ has: page.getByRole('columnheader', { name: 'Row', exact: true }) });
  assert.equal(await previewTable.locator('tbody tr').count(), 20);
  await page.screenshot({ path: `${evidence}/desktop-preview.png`, fullPage: true });
  const waitForImport = async () => {
    const deadline = Date.now() + 10000;
    while (!releaseImport && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
      typeof releaseImport,
      'function',
      'Fixture must observe the actual HTTP import request'
    );
  };
  const waitForRefresh = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/employees') && response.request().method() === 'GET'
    );
  const refreshed = waitForRefresh();
  await page.getByRole('button', { name: 'Import 25 valid employees', exact: true }).click();
  await page
    .getByText(
      'Import in progress. Closing or changing this preview does not cancel submitted rows.',
      { exact: true }
    )
    .waitFor();
  await waitForImport();
  releaseImport();
  await (await refreshed).finished();
  await page.waitForFunction(
    () =>
      !!document.querySelector('input[type=file]') ||
      document.body.textContent.includes('Import from CSV')
  );
  await page.waitForFunction(() => !document.body.textContent.includes('Importing employees…'), {
    timeout: 15000,
  });
  const posts = requests.filter(
    (r) => r.method === 'POST' && r.path === '/api/employees/bulk-import'
  );
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].body), { csv });
  assert.equal(posts[0].authorization, 'Bearer fixture-only-no-credentials');
  const resultVisible = await page
    .getByText('Imported 25 of 25 rows.', { exact: true })
    .isVisible();
  await page.screenshot({ path: `${evidence}/desktop-after-import.png`, fullPage: true });
  const report = {
    sourceBase: 'bec05631342cd795b2bed626f2449a3b3006f7c0',
    employeeEntrySha256: createHash('sha256')
      .update(await readFile(`${root}/src/pages/EmployeeEntry.tsx`))
      .digest('hex'),
    runtime: process.version,
    browser: await browser.version(),
    transport: 'Loopback HTTP fixture; no live database or credentials',
    previewRows: 20,
    totalRows: 25,
    rawCsvExact: true,
    oneAuthenticatedRequest: true,
    listReads,
    resultVisible,
    pageErrors: errors,
  };
  await writeFile(`${evidence}/receipt.json`, JSON.stringify(report, null, 2) + '\n');
  assert.equal(
    resultVisible,
    true,
    'Actual EmployeeEntry refresh must preserve the mounted import result'
  );

  // Actual partial response, not a mocked React callback.
  mode = 'partial';
  const partialRefresh = waitForRefresh();
  await page.getByRole('button', { name: 'Import 25 valid employees', exact: true }).click();
  await waitForImport();
  releaseImport();
  await (await partialRefresh).finished();
  await page.getByText('Imported 24 of 25 rows.', { exact: false }).waitFor();
  await page.getByText('1 row rejected by the backend.', { exact: false }).waitFor();

  // Rejected imports preserve preview and become retryable.
  mode = 'error';
  await page.getByRole('button', { name: 'Import 25 valid employees', exact: true }).click();
  await waitForImport();
  releaseImport();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Request failed with status code 400' })
    .waitFor();
  assert.equal(await previewTable.locator('tbody tr').count(), 20);
  assert.equal(
    await page.getByRole('button', { name: 'Import 25 valid employees', exact: true }).isEnabled(),
    true
  );

  // A replacement selection cannot receive the older in-flight result.
  mode = 'success';
  const replacementRefresh = waitForRefresh();
  await page.getByRole('button', { name: 'Import 25 valid employees', exact: true }).click();
  await waitForImport();
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'replacement.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv.replaceAll('Ada', 'Grace')),
    });
  await page.getByText('File: replacement.csv', { exact: true }).waitFor();
  releaseImport();
  await (await replacementRefresh).finished();
  await page.getByRole('button', { name: 'Import 25 valid employees', exact: true }).waitFor();
  assert.equal(await page.getByText('Imported 25 of 25 rows.', { exact: true }).count(), 0);

  // Closing the preview retains progress and suppresses stale feedback.
  const closedRefresh = waitForRefresh();
  await page.getByRole('button', { name: 'Import 25 valid employees', exact: true }).click();
  await waitForImport();
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  assert.equal(
    await page
      .getByText(
        'Import in progress. Closing or changing this preview does not cancel submitted rows.',
        { exact: true }
      )
      .isVisible(),
    true
  );
  releaseImport();
  await (await closedRefresh).finished();
  await page.getByRole('button', { name: 'Import from CSV', exact: true }).click();
  assert.equal(await page.getByText('Imported 25 of 25 rows.', { exact: true }).count(), 0);

  // Real mobile drag/drop invokes the existing FileReader and preview path.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[class*="border-dashed"]').evaluate((zone, content) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([content], 'dropped.csv', { type: 'text/csv' }));
    zone.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
    );
  }, csv);
  await page.getByText('Showing first 20 of 25 rows', { exact: true }).waitFor();
  assert.equal(await previewTable.locator('tbody tr').count(), 20);
  await page.screenshot({ path: `${evidence}/mobile-drop-preview.png`, fullPage: true });
  report.cases = [
    'file-picker quoted/multiline preview20-of25',
    'byte-exact authenticated request',
    'success survives awaited GET',
    'partial summary survives awaited GET',
    'rejected POST preserves retryable preview',
    'replacement suppresses stale result',
    'closed preview retains progress',
    'mobile real FileReader drag/drop',
  ];
  report.importRequests = requests.filter(
    (r) => r.method === 'POST' && r.path === '/api/employees/bulk-import'
  ).length;
  report.listReads = listReads;
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/receipt.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      evidence,
      cases: report.cases.length,
      resultVisible,
      pageErrors: errors,
      listReads,
    })
  );
} finally {
  releaseImport?.();
  await browser?.close();
  await vite.close();
  await new Promise((resolve) => api.close(resolve));
}
