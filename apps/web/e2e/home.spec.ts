import { expect, test } from '@playwright/test';

test('unauthenticated home redirects to the login page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'LIFE IT Smart Service Center' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ' })).toBeVisible();
});
