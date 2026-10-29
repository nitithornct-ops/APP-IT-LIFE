import { expect, test } from '@playwright/test';
import { installTicketUxFixture, ticket } from './helpers/ticketUxFixture';

const viewports = [
  [1920, 1080], [1600, 900], [1440, 900], [1366, 768], [1280, 800],
  [1024, 768], [768, 1024], [390, 844], [375, 812],
];

for (const [width, height] of viewports) {
  for (const theme of ['light', 'dark']) {
    for (const collapsed of [false, true]) {
      test(`spacing ${width}x${height} ${theme} sidebar ${collapsed ? 'collapsed' : 'expanded'}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await installTicketUxFixture(page);
        await page.addInitScript(({ theme, collapsed }) => {
          localStorage.setItem('itlife-theme', theme);
          localStorage.setItem('itlife-sidebar-collapsed', String(collapsed));
        }, { theme, collapsed });
        await page.goto('/tickets');
        await expect(page.getByRole('link', { name: ticket.title, exact: true })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: testInfo.outputPath('tickets.png'), fullPage: true });

        const geometry = await page.evaluate(() => {
          const main = document.querySelector<HTMLElement>('#main-content')!;
          const content = document.querySelector<HTMLElement>('.module-page-content')!;
          const m = main.getBoundingClientRect();
          const c = content.getBoundingClientRect();
          const header = document.querySelector<HTMLElement>('.life-page-header')!;
          const filters = document.querySelector<HTMLElement>('[data-ui="filter-bar"]')!;
          const h = header.getBoundingClientRect();
          const f = filters.getBoundingClientRect();
          const kpis = [...document.querySelectorAll<HTMLElement>('[data-ui="kpi-strip"] > *')].map(el => el.getBoundingClientRect());
          const controls = [...filters.querySelectorAll<HTMLElement>('input, select')].map(el => el.getBoundingClientRect());
          return {
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            gutter: parseFloat(getComputedStyle(main).paddingLeft),
            left: c.left - m.left, right: m.right - c.right,
            headerFilterOverlap: h.bottom - f.top,
            filterPadding: parseFloat(getComputedStyle(filters).paddingLeft),
            controlHeights: controls.map(r => r.height),
            controlsOutside: controls.filter(r => r.left < f.left - 1 || r.right > f.right + 1).length,
            kpiOverlaps: kpis.flatMap((a, i) => kpis.slice(i + 1).filter(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1)).length,
            cellContentOverflow: [...document.querySelectorAll<HTMLElement>('.data-table-cell-content')].filter(el => {
              const r = el.getBoundingClientRect();
              const cell = el.closest('td')!.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && (r.bottom > cell.bottom + 1 || r.top < cell.top - 1);
            }).length,
          };
        });
        expect(geometry.overflow).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.left - geometry.right)).toBeLessThanOrEqual(1);
        expect(geometry.gutter).toBe(width >= 1024 ? 32 : width >= 640 ? 24 : 16);
        expect(geometry.headerFilterOverlap).toBeLessThanOrEqual(0);
        expect(geometry.controlsOutside).toBe(0);
        expect(geometry.kpiOverlaps).toBe(0);
        expect(geometry.cellContentOverflow).toBe(0);
        expect(geometry.filterPadding).toBe(width >= 640 ? 24 : 16);
        expect(geometry.controlHeights.every(value => value >= 44)).toBe(true);

        await page.getByRole('button', { name: 'แจ้งซ่อมใหม่', exact: true }).click();
        const modal = page.getByRole('dialog', { name: 'เปิด Ticket แจ้งซ่อม' });
        await expect(modal).toBeVisible();
        // Exercise growth and validation without submitting a live record.
        await modal.locator('button[type="submit"]').click();
        const description = modal.locator('textarea').first();
        await description.fill('รายละเอียดปัญหาภาษาไทยสำหรับตรวจระยะห่างและข้อความหลายบรรทัด '.repeat(20));
        await page.evaluate(() => document.documentElement.style.setProperty('--font-scale', '1.2'));
        const modalGeometry = await modal.evaluate(el => {
          const r = el.getBoundingClientRect();
          const close = el.querySelector<HTMLElement>('[aria-label="ปิดหน้าต่าง"]')!.getBoundingClientRect();
          const body = el.querySelector<HTMLElement>('[data-modal-content]')!;
          const footer = el.querySelector('footer')?.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
            overflow: el.scrollWidth - el.clientWidth,
            closeInside: close.left >= r.left && close.right <= r.right && close.top >= r.top && close.bottom <= r.bottom,
            bodyFooterOverlap: footer ? body.getBoundingClientRect().bottom - footer.top : 0,
          };
        });
        expect(modalGeometry.left).toBeGreaterThanOrEqual(0);
        expect(modalGeometry.top).toBeGreaterThanOrEqual(0);
        expect(modalGeometry.right).toBeLessThanOrEqual(width);
        expect(modalGeometry.bottom).toBeLessThanOrEqual(height);
        expect(modalGeometry.overflow).toBeLessThanOrEqual(1);
        expect(modalGeometry.closeInside).toBe(true);
        expect(modalGeometry.bodyFooterOverlap).toBeLessThanOrEqual(1);
        await page.screenshot({ path: testInfo.outputPath('create-validation-scale120.png'), fullPage: true });
      });
    }
  }
}
