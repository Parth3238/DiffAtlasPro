import { test, expect } from '@playwright/test';

test('CSV diff detects added, removed, and modified rows', async ({ page }) => {
  await page.goto('/');

  const original = 'id,name,email,age\n1,Parth,parth@example.com,24\n2,Aman,aman@example.com,30\n3,Riya,riya@example.com,22\n4,Sana,sana@example.com,28';
  const modified = 'id,name,email,age\n2,Aman,aman@example.com,31\n1,Parth,parth@example.com,24\n3,Riya,riya.new@example.com,22\n5,Karan,karan@example.com,26';

  const textareas = page.locator('textarea');
  await textareas.nth(0).fill(original);
  await textareas.nth(1).fill(modified);

  await page.getByRole('button', { name: 'Load original file for comparison' }).click();
  await page.getByRole('button', { name: 'Load modified file for comparison' }).click();

  await expect(page.getByText(/1 added, 1 removed, 2 modified/i).first()).toBeVisible({ timeout: 10000 });
});
