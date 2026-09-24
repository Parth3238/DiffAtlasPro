import { test, expect } from '@playwright/test';

test('loads the app and shows Diff Mode by default', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('DiffAtlas')).toBeVisible();
  await expect(page.getByText('Diff Mode')).toBeVisible();
});

test('JSON diff produces a result', async ({ page }) => {
  await page.goto('/');

  const original = JSON.stringify({ name: 'Parth', age: 24 });
  const modified = JSON.stringify({ name: 'Parth', age: 25 });

  const textareas = page.locator('textarea');
  await textareas.nth(0).fill(original);
  await textareas.nth(1).fill(modified);

  await page.getByRole('button', { name: 'Load original file for comparison' }).click();
  await page.getByRole('button', { name: 'Load modified file for comparison' }).click();

  await expect(page.getByText(/modified/i).first()).toBeVisible({ timeout: 10000 });
});
