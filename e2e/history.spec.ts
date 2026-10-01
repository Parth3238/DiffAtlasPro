import { test, expect } from '@playwright/test';

test('a completed diff is saved to History and can be reloaded', async ({ page }) => {
  await page.goto('/');

  const original = JSON.stringify({ name: 'Parth', age: 24 });
  const modified = JSON.stringify({ name: 'Parth', age: 25 });

  const textareas = page.locator('textarea');
  await textareas.nth(0).fill(original);
  await textareas.nth(1).fill(modified);

  await page.getByRole('button', { name: 'Load original file for comparison' }).click();
  await page.getByRole('button', { name: 'Load modified file for comparison' }).click();

  await expect(page.getByText(/1 modified/i).first()).toBeVisible({ timeout: 10000 });

  const historyRegion = page.getByRole('region', { name: /diff history/i });
  await expect(historyRegion.getByText(/1 recent diff/i)).toBeVisible({ timeout: 10000 });

  await page.reload();
  await historyRegion.getByText(/json/i).first().click();

  await expect(page.getByText(/1 modified/i).first()).toBeVisible({ timeout: 10000 });
});
