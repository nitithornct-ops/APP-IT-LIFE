import { expect, test } from '@playwright/test';

test('home page loads and shows the app title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'LIFE IT Smart Service Center' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ตรวจสอบสถานะ API' })).toBeVisible();
});
