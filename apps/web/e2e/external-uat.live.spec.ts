import { expect, test } from '@playwright/test';
import { installLiveSession } from './helpers/liveAuth';

test.skip(process.env.LIVE_EXTERNAL_UAT_E2E !== '1', 'External role UAT is opt-in');
test.describe.configure({ mode: 'serial' });

interface UatRole {
  label: string;
  envPrefix: string;
  roleKey: string;
  allowedPermission: string;
  allowedPath: string;
  deniedPermission?: string;
  deniedPath?: string;
  requiresTotp?: boolean;
  mobile?: boolean;
}

const roles: UatRole[] = [
  { label: 'Requester', envPrefix: 'UAT_REQUESTER', roleKey: 'user', allowedPermission: 'ticket.view', allowedPath: '/tickets', deniedPermission: 'setting.manage', deniedPath: '/admin/settings', mobile: true },
  { label: 'Technician', envPrefix: 'UAT_TECHNICIAN', roleKey: 'technician', allowedPermission: 'ticket.update', allowedPath: '/tickets', deniedPermission: 'role.manage', deniedPath: '/admin/roles', requiresTotp: true },
  { label: 'Approver', envPrefix: 'UAT_APPROVER', roleKey: 'approver', allowedPermission: 'workflow.approve', allowedPath: '/workflows', deniedPermission: 'role.manage', deniedPath: '/admin/roles', requiresTotp: true },
  { label: 'Manager', envPrefix: 'UAT_MANAGER', roleKey: 'manager', allowedPermission: 'report.export', allowedPath: '/reports', deniedPermission: 'role.manage', deniedPath: '/admin/roles', requiresTotp: true },
  { label: 'Admin', envPrefix: 'UAT_ADMIN', roleKey: process.env.UAT_ADMIN_ROLE ?? 'super_admin', allowedPermission: 'setting.manage', allowedPath: '/admin/settings', requiresTotp: true },
];

for (const role of roles) {
  test(`${role.label} completes its route and permission-boundary checks`, async ({ page }) => {
    const email = process.env[`${role.envPrefix}_EMAIL`];
    const totpSecret = process.env[`${role.envPrefix}_TOTP_SECRET`];
    if (!email) throw new Error(`${role.envPrefix}_EMAIL is required`);
    if (role.requiresTotp && !totpSecret) throw new Error(`${role.envPrefix}_TOTP_SECRET is required`);
    if (role.mobile) await page.setViewportSize({ width: 390, height: 844 });

    const session = await installLiveSession(page, email, totpSecret);
    const meResponse = await page.request.get('http://127.0.0.1:8787/api/v1/auth/me', {
      headers: { authorization: `Bearer ${session.access_token}` },
    });
    expect(meResponse.status()).toBe(200);
    const payload = await meResponse.json();
    const roleKeys = (payload.data.roles as Array<{ role_key: string }>).map((item) => item.role_key);
    const permissions = payload.data.permissions as string[];
    expect(roleKeys).toContain(role.roleKey);
    expect(permissions).toContain(role.allowedPermission);
    if (role.deniedPermission) expect(permissions).not.toContain(role.deniedPermission);

    await page.goto(role.allowedPath);
    await expect(page.getByTestId('access-denied')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();

    if (role.deniedPath) {
      await page.goto(role.deniedPath);
      await expect(page.getByTestId('access-denied')).toBeVisible();
    }
  });
}

test('Vendor signs in through the isolated company portal on mobile', async ({ page }) => {
  const vendorCode = process.env.UAT_VENDOR_CODE;
  const email = process.env.UAT_VENDOR_EMAIL;
  const password = process.env.UAT_VENDOR_PASSWORD;
  if (!vendorCode || !email || !password) throw new Error('UAT vendor credentials are required');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/vendor/portal');
  const form = page.locator('form');
  await form.locator('input').nth(0).fill(vendorCode);
  await form.locator('input').nth(1).fill(email);
  await form.locator('input').nth(2).fill(password);
  await form.locator('button[type="submit"]').click();
  await expect(page.getByText(vendorCode, { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
});
