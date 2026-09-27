import { test, expect } from '@playwright/test';

test('YAML diff detects changed values', async ({ page }) => {
  await page.goto('/');

  const original = 'name: Parth\nage: 24\ncity: Faridabad';
  const modified = 'name: Parth\nage: 25\ncity: Delhi';

  const textareas = page.locator('textarea');
  await textareas.nth(0).fill(original);
  await textareas.nth(1).fill(modified);

  await page.getByRole('button', { name: 'Load original file for comparison' }).click();
  await page.getByRole('button', { name: 'Load modified file for comparison' }).click();

  await expect(page.getByText(/2 modified/i).first()).toBeVisible({ timeout: 10000 });
});
