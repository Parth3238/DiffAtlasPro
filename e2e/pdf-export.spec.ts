import { test, expect } from '@playwright/test';

test('Export Report (PDF) downloads a PDF file', async ({ page }) => {
  await page.goto('/');

  const original = JSON.stringify({ name: 'Parth', age: 24 });
  const modified = JSON.stringify({ name: 'Parth', age: 25 });

  const textareas = page.locator('textarea');
  await textareas.nth(0).fill(original);
  await textareas.nth(1).fill(modified);

  await page.getByRole('button', { name: 'Load original file for comparison' }).click();
  await page.getByRole('button', { name: 'Load modified file for comparison' }).click();

  await expect(page.getByText(/1 modified/i).first()).toBeVisible({ timeout: 10000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /export report/i }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
});
