import { expect, test } from '@playwright/test';
import { installTicketUxFixture, ticket } from './helpers/ticketUxFixture';

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`shared ticket layout keeps consistent gutters at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installTicketUxFixture(page);
    await page.goto('/tickets');
    await expect(page.getByRole('link', { name: ticket.title, exact: true })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('#main-content');
      const content = document.querySelector<HTMLElement>('.module-page-content');
      const header = document.querySelector<HTMLElement>('.life-page-header');
      const filters = document.querySelector<HTMLElement>('[data-ui="filter-bar"]');
      if (!main || !content || !header || !filters) throw new Error('Required ticket layout elements missing');
      const mainStyle = getComputedStyle(main);
      const mainRect = main.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const filtersRect = filters.getBoundingClientRect();
      const gutter = parseFloat(mainStyle.paddingLeft);
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        gutter,
        left: contentRect.left - mainRect.left,
        right: mainRect.right - contentRect.right,
        headerWidth: headerRect.width,
        headerLeft: headerRect.left,
        filtersLeft: filtersRect.left,
        filtersRight: filtersRect.right,
        contentRight: contentRect.right,
      };
    });
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.left - geometry.right)).toBeLessThanOrEqual(2);
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.gutter - 1);
    expect(geometry.filtersLeft).toBeGreaterThanOrEqual(geometry.headerLeft - 2);
    expect(geometry.filtersRight).toBeLessThanOrEqual(geometry.contentRight + 2);
    expect(geometry.headerWidth).toBeGreaterThan(0);
    if (viewport.width === 1920) expect(geometry.gutter).toBe(32);

    await page.getByRole('button', { name: 'แจ้งซ่อมใหม่', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'เปิด Ticket แจ้งซ่อม' });
    await expect(modal).toBeVisible();
    const modalGeometry = await modal.evaluate((el) => ({
      overflow: el.scrollWidth - el.clientWidth,
      width: el.getBoundingClientRect().width,
    }));
    expect(modalGeometry.overflow).toBeLessThanOrEqual(1);
    expect(modalGeometry.width).toBeLessThanOrEqual(viewport.width);
  });
}
