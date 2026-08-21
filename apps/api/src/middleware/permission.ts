import type { Context, MiddlewareHandler } from 'hono';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { fail } from '../utils/response';

/**
 * ถามสิทธิ์จาก Database ตรง ๆ — export ไว้ให้ route ที่ต้องตัดสินใจต่อสิทธิ์ที่มี
 * ไม่ใช่แค่ผ่าน/ไม่ผ่าน เช่น endpoint ที่เปลี่ยนหลายอย่างในครั้งเดียว ซึ่งแต่ละอย่างใช้สิทธิ์คนละตัว
 */
export async function hasPermission(c: Context<AppEnv>, permissionKey: string): Promise<boolean> {
  const supabase = c.get('supabase');
  const { data, error } = await supabase.rpc('has_permission', { permission_key_input: permissionKey });
  return !error && data === true;
}

async function denyAndAudit(c: Context<AppEnv>, permissionKeys: string[]): Promise<Response> {
  await writeAuditLog(c.env, {
    actorId: c.get('userId'),
    actorEmail: c.get('userEmail'),
    action: 'ACCESS_DENIED',
    module: permissionKeys[0]?.split('.')[0] ?? 'unknown',
    result: 'denied',
    detail: { permissionKeys, path: c.req.path },
    requestId: c.get('requestId'),
  });
  return c.json(fail(c.get('requestId'), 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์ดำเนินการนี้'), 403);
}

/**
 * ตรวจสิทธิ์จริงจาก Database ทุกครั้ง (ไม่เชื่อค่าจาก Frontend) — ใช้ต่อจาก requireAuth เสมอ
 * เรียก public.has_permission() ตัวเดียวกับที่ RLS ใช้ (Phase 2) ผ่าน Supabase RPC
 */
export function requirePermission(permissionKey: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!(await hasPermission(c, permissionKey))) {
      return denyAndAudit(c, [permissionKey]);
    }
    await next();
  };
}

/** อนุญาตถ้ามีสิทธิ์อย่างน้อยหนึ่งใน permissionKeys ที่ระบุ (เช่น role.view หรือ role.manage) */
export function requireAnyPermission(permissionKeys: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    for (const key of permissionKeys) {
      if (await hasPermission(c, key)) {
        await next();
        return;
      }
    }
    return denyAndAudit(c, permissionKeys);
  };
}
