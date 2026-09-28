import { test, expect } from '@playwright/test';

test('shareable link reloads the same diff', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');

  const original = JSON.stringify({ name: 'Parth', age: 24 });
  const modified = JSON.stringify({ name: 'Parth', age: 25 });

  const textareas = page.locator('textarea');
  await textareas.nth(0).fill(original);
  await textareas.nth(1).fill(modified);

  await page.getByRole('button', { name: 'Load original file for comparison' }).click();
  await page.getByRole('button', { name: 'Load modified file for comparison' }).click();

  await expect(page.getByText(/1 modified/i).first()).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: /copy shareable link/i }).click();

  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain('#');

  await page.goto(link);
  await expect(page.getByText(/1 modified/i).first()).toBeVisible({ timeout: 10000 });
});
