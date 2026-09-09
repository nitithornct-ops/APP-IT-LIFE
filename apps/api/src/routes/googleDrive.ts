import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { writeAuditLog } from '../services/auditService';
import { googleDriveConfig, uploadCsvAsGoogleSheet } from '../services/googleDriveService';
import type { AppEnv } from '../types';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import { exportToSheetSchema } from '../validators/googleDrive';

export const googleDriveRoute = new Hono<AppEnv>();

googleDriveRoute.use('*', requireAuth);

/**
 * ให้หน้าเว็บรู้ว่าปลายทาง Google Drive ถูกตั้งค่าไว้จริงหรือยัง — ถ้ายัง ปุ่ม "ส่งไป Google Sheets"
 * จะไม่ถูกแสดงเลย ดีกว่าปล่อยให้ผู้ใช้กดแล้วเจอข้อความว่าระบบยังไม่ได้ตั้งค่า
 */
googleDriveRoute.get('/status', (c) => c.json(ok(c.get('requestId'), {
  enabled: googleDriveConfig(c.env) !== null,
})));

/**
 * ส่ง CSV ที่ผู้ใช้ส่งออกอยู่แล้วขึ้นไปเป็น Google Sheets หนึ่งไฟล์
 *
 * รับ CSV จากหน้าเว็บแทนที่จะดึงข้อมูลใหม่เอง เพราะ CSV ก้อนนั้นถูกประกอบผ่านเส้นทางส่งออกเดิม
 * ที่ตรวจสิทธิ์และกรองข้อมูลตาม RLS มาแล้ว — การให้ endpoint นี้ไปดึงข้อมูลเองอีกทางจะกลายเป็น
 * ช่องอ่านข้อมูลช่องที่สองที่ต้องมาไล่ตรวจสิทธิ์ซ้ำให้ตรงกันตลอดไป
 *
 * ผลที่ตามมาคือ endpoint นี้ยอมรับเนื้อหาที่ผู้ใช้ส่งมา จึงจำกัดความเสี่ยงด้วย requireAuth,
 * เพดานขนาดไฟล์ และการบันทึก audit ทุกครั้งว่าใครส่งไฟล์ชื่ออะไรขึ้นไปเมื่อไหร่
 */
googleDriveRoute.post('/sheets', zValidator('json', exportToSheetSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const { filename, csv } = c.req.valid('json');

  if (!googleDriveConfig(c.env)) {
    return c.json(fail(reqId, 'GOOGLE_DRIVE_NOT_CONFIGURED', 'ยังไม่ได้เปิดใช้งานการเชื่อมต่อ Google Drive'), 503);
  }

  const result = await uploadCsvAsGoogleSheet(c.env, { name: filename, csv });

  // การส่งข้อมูลออกนอกระบบต้องตรวจย้อนได้ทั้งครั้งที่สำเร็จและครั้งที่ล้ม ไม่ใช่เฉพาะครั้งที่สำเร็จ
  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'EXPORT_GOOGLE_SHEET',
    module: 'google_drive',
    targetId: result.ok ? result.file.id : null,
    detail: { filename, bytes: new TextEncoder().encode(csv).length, reason: result.ok ? null : result.reason },
    result: result.ok ? 'success' : 'fail',
    requestId: reqId,
  });

  if (!result.ok) {
    return c.json(
      fail(reqId, result.reason === 'configuration' ? 'GOOGLE_DRIVE_NOT_CONFIGURED' : 'GOOGLE_DRIVE_UPLOAD_FAILED', result.message),
      result.reason === 'configuration' ? 503 : 502,
    );
  }

  return c.json(ok(reqId, result.file));
});
