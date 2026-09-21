import { expect, test } from '@playwright/test';
import { provisionExternalUatFixture, type ExternalUatFixture } from './helpers/externalUatFixture';
import { installLiveSession, seedSupabaseSession } from './helpers/liveAuth';

test.skip(process.env.LIVE_EXTERNAL_UAT_E2E !== '1', 'External role UAT is opt-in');
test.describe.configure({ mode: 'serial' });

interface UatRole {
  label: string;
  fixtureKey: keyof ExternalUatFixture['roleEmails'];
  roleKey: string;
  allowedPermission: string;
  allowedPath: string;
  deniedPermission?: string;
  deniedPath?: string;
  mobile?: boolean;
}

const roles: UatRole[] = [
  { label: 'Requester', fixtureKey: 'UAT_REQUESTER', roleKey: 'user', allowedPermission: 'ticket.view', allowedPath: '/tickets', deniedPermission: 'setting.manage', deniedPath: '/admin/settings', mobile: true },
  { label: 'Technician', fixtureKey: 'UAT_TECHNICIAN', roleKey: 'technician', allowedPermission: 'ticket.update', allowedPath: '/tickets', deniedPermission: 'role.manage', deniedPath: '/admin/roles' },
  { label: 'Approver', fixtureKey: 'UAT_APPROVER', roleKey: 'approver', allowedPermission: 'workflow.approve', allowedPath: '/workflows', deniedPermission: 'role.manage', deniedPath: '/admin/roles' },
  { label: 'Manager', fixtureKey: 'UAT_MANAGER', roleKey: 'manager', allowedPermission: 'report.export', allowedPath: '/reports', deniedPermission: 'role.manage', deniedPath: '/admin/roles' },
  { label: 'Admin', fixtureKey: 'UAT_ADMIN', roleKey: 'super_admin', allowedPermission: 'setting.manage', allowedPath: '/admin/settings' },
];

let fixture: ExternalUatFixture;
test.beforeAll(async () => { fixture = await provisionExternalUatFixture(); });
test.afterAll(async () => { await fixture?.cleanup(); });

for (const role of roles) {
  test(`${role.label} completes its route and permission-boundary checks`, async ({ page }) => {
    const email = fixture.roleEmails[role.fixtureKey];
    if (role.mobile) await page.setViewportSize({ width: 390, height: 844 });

    const session = await installLiveSession(page, email);
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
    await expect(page.locator('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])').first()).toBeVisible();

    if (role.deniedPath) {
      await page.goto(role.deniedPath);
      await expect(page.getByTestId('access-denied')).toBeVisible();
    }
  });
}

test('Vendor accesses the isolated company portal with an AAL2 session on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSupabaseSession(page, fixture.vendor.session);
  await page.goto('/vendor/portal');
  await expect(page.getByText(fixture.vendor.code, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])').first()).toBeVisible();
});
