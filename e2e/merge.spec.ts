import { test, expect } from '@playwright/test';

test('three-way merge auto-merges non-conflicting changes', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('tab', { name: 'Merge Mode' }).click();

  const base = JSON.stringify({ title: 'Plan', status: 'draft', budget: 5000 });
  const left = JSON.stringify({ title: 'Plan', status: 'in-review', budget: 5000 });
  const right = JSON.stringify({ title: 'Plan', status: 'draft', budget: 7000 });

  const textareas = page.locator('textarea');
  await textareas.nth(0).fill(base);
  await textareas.nth(1).fill(left);
  await textareas.nth(2).fill(right);

  await page.getByRole('button', { name: 'Load base file for comparison' }).click();
  await page.getByRole('button', { name: 'Load left (yours) file for comparison' }).click();
  await page.getByRole('button', { name: 'Load right (theirs) file for comparison' }).click();

  await page.getByRole('button', { name: 'Merge' }).click();

  await expect(page.getByText(/clean merge, no conflicts/i)).toBeVisible({ timeout: 10000 });
});
