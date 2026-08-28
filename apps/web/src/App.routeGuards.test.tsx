import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PERMISSION_KEYS } from '@itlife/shared';
import { NAV_GROUPS } from './config/navigation';

/**
 * A route that renders an admin page behind a bare <ProtectedRoute> is reachable by typing its
 * URL, no matter what the sidebar hides — hiding a menu item is UX, not access control. These
 * tests read App.tsx as text so a future route cannot quietly ship without a permission.
 */
const appSource = readFileSync(resolve(__dirname, 'App.tsx'), 'utf8');

/** Routes that are intentionally open to every signed-in user. Add here only with a reason. */
const ROUTES_WITHOUT_PERMISSION = new Set([
  '/profile', // ทุกคนต้องแก้ข้อมูลของตนเองได้ — Backend จำกัดไว้ที่ full_name/phone แล้ว
  '*', // หน้า 404 ต้องเข้าถึงได้ทุกคนที่ login แล้ว ไม่งั้นพิมพ์ URL ผิดจะเจอ "ไม่มีสิทธิ์" แทน "ไม่พบหน้า"
  '/system-status', // ทุกคนที่ล็อกอินแล้วต้องดูได้ว่าระบบยังทำงานอยู่ไหม ไม่ผูกกับสิทธิ์ใด
]);

/** Public routes rendered outside <ProtectedRoute> by design. */
const PUBLIC_ROUTES = new Set([
  '/login',
  '/mfa',
  '/forgot-password',
  '/reset-password',
  '/health',
  '/line',
  '/line/callback',
  '/report',
  '/vendor/forms',
  '/vendor/forms/:token', // legacy links only; newly generated links carry the token in a fragment
  '/vendor/portal', // company-only session and API authorization; never uses internal employee RBAC
]);

interface RouteDeclaration {
  path: string;
  guard: string;
}

/**
 * Pull every `<Route path="..." element={...}>` out of App.tsx with the JSX that belongs to it.
 * ขอบเขตของแต่ละ route ต้องจบที่ <Route ตัวถัดไป ไม่ใช่ตัดตามจำนวนตัวอักษรตายตัว
 * มิฉะนั้นการตรวจจะไปอ่าน permission ของ route ถัดไปมาตอบแทน
 */
function parseRoutes(source: string): RouteDeclaration[] {
  const matches = [...source.matchAll(/<Route\s+path="([^"]+)"/g)];
  return matches.map((match, index) => ({
    path: match[1],
    guard: source.slice(match.index, matches[index + 1]?.index ?? source.length),
  }));
}

const routes = parseRoutes(appSource);

describe('App route guards', () => {
  it('declares routes', () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  /**
   * URL ที่ไม่ตรง route ใดเลยเคยได้จอว่างเปล่า ผู้ใช้แยกไม่ออกว่าพิมพ์ผิดหรือระบบพัง
   * React Router เลือก route ตามความจำเพาะ แต่ `*` ต้องถูกประกาศเป็นตัวสุดท้ายอยู่ดี
   * เพื่อไม่ให้ใครเผลอเพิ่ม route ใหม่ต่อท้ายมันแล้วเข้าไม่ถึงตลอดไป
   */
  it('ends with a catch-all route so an unknown URL never renders a blank screen', () => {
    const paths = routes.map((route) => route.path);
    expect(paths).toContain('*');
    expect(paths.at(-1)).toBe('*');
  });

  it.each(routes.filter((route) => !PUBLIC_ROUTES.has(route.path)).map((route) => [route.path, route.guard]))(
    'protected route %s declares a permission',
    (path, guard) => {
      if (ROUTES_WITHOUT_PERMISSION.has(path as string)) return;
      const hasPermission = /permission="[^"]+"/.test(guard as string) || /anyPermission=\{/.test(guard as string);
      expect(hasPermission, `route ${path} ต้องระบุ permission หรือ anyPermission ใน <ProtectedRoute>`).toBe(true);
    },
  );

  it('only references permission keys that exist in the shared constant list', () => {
    const referenced = [...appSource.matchAll(/['"]([a-z_]+\.[a-z_]+)['"]/g)].map((match) => match[1]);
    const known = new Set<string>(DEFAULT_PERMISSION_KEYS);
    const unknown = [...new Set(referenced)].filter((key) => !known.has(key));
    expect(unknown, `permission key ที่ไม่มีใน DEFAULT_PERMISSION_KEYS: ${unknown.join(', ')}`).toEqual([]);
  });

  it('keeps every sidebar destination in step with the route that renders it', () => {
    const navPaths = NAV_GROUPS.flatMap((group) => group.items).map((item) => item.path);
    const routePaths = new Set(routes.map((route) => route.path));
    const orphans = navPaths.filter((path) => !routePaths.has(path));
    expect(orphans, `เมนูชี้ไปยัง route ที่ไม่มีอยู่: ${orphans.join(', ')}`).toEqual([]);
  });

  /**
   * เมนู "หน้าหลัก" เคยไม่ประกาศ permission แต่ route '/' ต้องมี dashboard.view ผู้ใช้บาง role
   * จึงเห็นเมนู กดแล้วเจอ Access Denied (พบตอน Pre-production QA audit 2026-08-13)
   * เมนูที่ซ่อนไว้ไม่ใช่การควบคุมสิทธิ์ แต่เมนูที่โชว์ทั้งที่กดไม่ได้คือความผิดพลาดของ UX
   */
  it('never shows a menu item whose route requires a permission the menu does not declare', () => {
    const mismatched: string[] = [];
    for (const item of NAV_GROUPS.flatMap((group) => group.items)) {
      const guard = routes.find((route) => route.path === item.path)?.guard ?? '';
      const routeKey = /permission="([^"]+)"/.exec(guard)?.[1];
      if (!routeKey) continue;
      const declared = item.permission ? [item.permission] : (item.anyPermission ?? []);
      if (!declared.includes(routeKey)) mismatched.push(`${item.label} (${item.path}) ต้องประกาศ ${routeKey}`);
    }
    expect(mismatched, mismatched.join(' · ')).toEqual([]);
  });

  it('gives the Master Data menu and its route the same permission set', () => {
    const navItem = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.path === '/admin/master-data');
    const routeGuard = routes.find((route) => route.path === '/admin/master-data')?.guard ?? '';
    expect(navItem?.anyPermission).toBeDefined();
    for (const key of navItem?.anyPermission ?? []) {
      expect(routeGuard, `route /admin/master-data ต้องรวมสิทธิ์ ${key} เหมือนเมนู`).toContain(key);
    }
  });
});
