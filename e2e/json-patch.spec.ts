import { test, expect } from '@playwright/test';

test('Copy as JSON Patch produces a valid RFC 6902 patch', async ({ page, context }) => {
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

  await page.getByRole('button', { name: /copy as json patch/i }).click();

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const patch = JSON.parse(copied);

  expect(Array.isArray(patch)).toBe(true);
  expect(patch).toEqual([{ op: 'replace', path: '/age', value: 25 }]);
});
