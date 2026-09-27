import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('image diff highlights changed regions', async ({ page }) => {
  await page.goto('/');

  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.nth(0).setInputFiles(path.join(__dirname, 'fixtures', 'image-original.png'));
  await fileInputs.nth(1).setInputFiles(path.join(__dirname, 'fixtures', 'image-modified.png'));

  await page.getByRole('button', { name: 'Load original file for comparison' }).click();
  await page.getByRole('button', { name: 'Load modified file for comparison' }).click();

  await expect(page.getByText(/%.*changed/i).first()).toBeVisible({ timeout: 15000 });
});
