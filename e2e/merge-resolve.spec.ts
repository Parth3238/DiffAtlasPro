import { test, expect } from '@playwright/test';

test('conflict can be manually resolved by choosing Use Left', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Merge Mode' }).click();

  const base = JSON.stringify({ title: 'Plan', budget: 5000 });
  const left = JSON.stringify({ title: 'Plan', budget: 8000 });
  const right = JSON.stringify({ title: 'Plan', budget: 6500 });

  const textareas = page.locator('textarea');
  await textareas.nth(0).fill(base);
  await textareas.nth(1).fill(left);
  await textareas.nth(2).fill(right);

  await page.getByRole('button', { name: 'Load base file for comparison' }).click();
  await page.getByRole('button', { name: 'Load left (yours) file for comparison' }).click();
  await page.getByRole('button', { name: 'Load right (theirs) file for comparison' }).click();

  await page.getByRole('button', { name: 'Merge' }).click();
  await expect(page.getByText('1 conflict')).toBeVisible({ timeout: 10000 });

  await page.getByRole('radio', { name: /use left/i }).check();
  await page.getByRole('button', { name: /apply resolutions/i }).click();
});
