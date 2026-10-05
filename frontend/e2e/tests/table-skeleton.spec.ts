import { test, expect, type Page } from '@playwright/test';

async function geometry(page: Page) {
  return page.evaluate(() => ({
    headers: Array.from(document.querySelectorAll('th'), (cell) => {
      const rect = cell.getBoundingClientRect();
      return [rect.x, rect.width];
    }),
    below: document.querySelector('[data-testid="below-table"]')!.getBoundingClientRect().y,
    frameHeight: document.querySelector('.payd-table-region')!.getBoundingClientRect().height,
  }));
}

test.beforeEach(async ({ page }) => {
  // This fixture never needs a backend, wallet, or external image service.
  await page.route('https://**/*', (route) => route.abort());
});

test('configured rows retain headers and viewport through loaded and empty states', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/table-skeleton.html');
  await expect(page.locator('[data-skeleton-row]')).toHaveCount(20);
  await expect(page.locator('[data-skeleton-row] td')).toHaveCount(120);
  await expect(page.getByRole('status')).toHaveText('Loading records');
  await expect(page.locator('tbody')).toHaveAttribute('aria-busy', 'true');
  const loadingGeometry = await geometry(page);
  await page.getByRole('button', { name: 'Show records', exact: true }).click();
  await expect(page.locator('[data-skeleton-row]')).toHaveCount(0);
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await expect(page.locator('tbody')).toHaveAttribute('aria-busy', 'false');
  expect(await geometry(page)).toEqual(loadingGeometry);
  await page.getByRole('button', { name: 'Show empty result' }).click();
  await expect(page.getByRole('cell', { name: 'No records', exact: true })).toBeVisible();
  expect(await geometry(page)).toEqual(loadingGeometry);
});

test('EmployeeList uses shared skeletons without unmounting its real headers', async ({ page }) => {
  await page.goto('/e2e/fixtures/table-skeleton.html?employees');
  await expect(page.locator('[data-skeleton-row]')).toHaveCount(5);
  await expect(page.getByRole('columnheader')).toHaveCount(6);
  const loadingGeometry = await geometry(page);
  await page.getByRole('button', { name: 'Show records', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Engineer', exact: true })).toBeVisible();
  await expect(page.locator('[data-skeleton-row]')).toHaveCount(0);
  expect(await geometry(page)).toEqual(loadingGeometry);
  await page.getByRole('button', { name: 'Show empty result' }).click();
  await expect(page.getByRole('cell', { name: 'No employees found', exact: true })).toBeVisible();
  expect(await geometry(page)).toEqual(loadingGeometry);
});

test('placeholders do not shimmer and reduced-motion disables the content fade', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/e2e/fixtures/table-skeleton.html');
  await expect(page.locator('[data-skeleton-row]')).toHaveCount(20);
  expect(
    await page
      .locator('.payd-table-placeholder')
      .first()
      .evaluate((cell) => getComputedStyle(cell).animationName)
  ).toBe('none');
  await page.getByRole('button', { name: 'Show records', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(20);
  expect(
    await page
      .locator('tbody tr')
      .first()
      .evaluate((row) => getComputedStyle(row).animationName)
  ).toBe('none');
});
