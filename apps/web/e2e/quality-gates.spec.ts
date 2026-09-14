import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});
test('login passes the accessibility and responsive layout gate', async ({ page }, testInfo) => {
  await page.goto('/login');
  await expect(page.locator('main')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations, JSON.stringify(accessibility.violations, null, 2)).toEqual([]);

  // WebKit is the cross-engine functional/accessibility gate. Chromium's three
  // fixed viewports additionally provide committed visual-regression baselines.
  if (testInfo.project.name.startsWith('quality-')) {
    await expect(page).toHaveScreenshot('login.png', { fullPage: true });
  }
});
