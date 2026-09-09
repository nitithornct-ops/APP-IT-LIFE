import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { hasPermission, requirePermission } from '../middleware/permission';
import { rateLimit } from '../middleware/rateLimit';
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
googleDriveRoute.get('/status', async (c) => c.json(ok(c.get('requestId'), {
  enabled: googleDriveConfig(c.env) !== null,
  // ปลายทางตั้งค่าไว้แล้วไม่ได้แปลว่าผู้ใช้คนนี้ส่งออกได้ ถ้าไม่บอกสิทธิ์กลับไปด้วย ปุ่มจะโผล่ให้ทุกคน
  // ที่ล็อกอินได้ แล้วคนที่ไม่มีสิทธิ์จะกดแล้วเจอ 403 ทุกครั้งโดยไม่มีอะไรบอกล่วงหน้า
  canExport: await hasPermission(c, 'report.export'),
})));

/**
 * ส่ง CSV ที่ผู้ใช้ส่งออกอยู่แล้วขึ้นไปเป็น Google Sheets หนึ่งไฟล์
 *
 * รับ CSV จากหน้าเว็บแทนที่จะดึงข้อมูลใหม่เอง เพราะ CSV ก้อนนั้นถูกประกอบผ่านเส้นทางส่งออกเดิม
 * ที่ตรวจสิทธิ์และกรองข้อมูลตาม RLS มาแล้ว — การให้ endpoint นี้ไปดึงข้อมูลเองอีกทางจะกลายเป็น
 * ช่องอ่านข้อมูลช่องที่สองที่ต้องมาไล่ตรวจสิทธิ์ซ้ำให้ตรงกันตลอดไป
 *
 * ผลที่ตามมาคือ endpoint นี้ยอมรับเนื้อหาที่ผู้ใช้ส่งมา ลำพัง requireAuth จึงไม่พอ — บัญชีที่ล็อกอินได้
 * แต่ไม่มีสิทธิ์ดูหรือส่งออกโมดูลใดเลย ก็ยิงเข้ามาตรง ๆ ได้ และเขียนไฟล์ลง Shared Drive ขององค์กร
 * ผ่าน Service Account ซึ่งไม่ได้ผูกกับสิทธิ์ของผู้เรียก ปุ่มที่ UI ซ่อนไว้ไม่ได้กันอะไรทั้งสิ้น
 * จึงต้องมีทั้งสิทธิ์ `report.export` (สิทธิ์ "นำข้อมูลออกนอกระบบ" ตัวเดียวกับที่ Report Center ใช้)
 * เพดานจำนวนครั้งต่อผู้ใช้ เพดานขนาดไฟล์ และ audit log ทุกครั้ง
 */
googleDriveRoute.post(
  '/sheets',
  requirePermission('report.export'),
  rateLimit({ windowMs: 3600_000, max: 60, keyFn: (c) => `drive_sheet_export:${c.get('userId')}` }),
  zValidator('json', exportToSheetSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const { filename, csv } = c.req.valid('json');

    if (!googleDriveConfig(c.env)) {
      return c.json(fail(reqId, 'GOOGLE_DRIVE_NOT_CONFIGURED', 'ยังไม่ได้เปิดใช้งานการเชื่อมต่อ Google Drive'), 503);
    }

    const result = await uploadCsvAsGoogleSheet(c.env, { name: filename, csv });

    // การส่งข้อมูลออกนอกระบบต้องตรวจย้อนได้ทั้งครั้งที่สำเร็จและครั้งที่ล้ม ไม่ใช่เฉพาะครั้งที่สำเร็จ
    //
    // ไฟล์ถูกเขียนขึ้น Drive ไปแล้วตั้งแต่บรรทัดบน ถ้าปล่อยให้ writeAuditLog โยน error ทะลุออกไป
    // ผู้ใช้จะได้ error ทั้งที่ไฟล์ขึ้นไปแล้ว แล้วกดซ้ำจนได้ไฟล์ซ้ำใน Drive จึงกลืน error ไว้ตรงนี้
    // แล้วรายงานกลับไปแทน — เสีย audit หนึ่งรายการดีกว่าเสียทั้งไฟล์และได้ของซ้ำ และผู้เรียกยังรู้ตัว
    let auditFailed = false;
    try {
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
    } catch (error) {
      auditFailed = true;
      console.error('EXPORT_GOOGLE_SHEET audit write failed', { requestId: reqId, error });
    }

    if (!result.ok) {
      return c.json(
        fail(reqId, result.reason === 'configuration' ? 'GOOGLE_DRIVE_NOT_CONFIGURED' : 'GOOGLE_DRIVE_UPLOAD_FAILED', result.message),
        result.reason === 'configuration' ? 503 : 502,
      );
    }

    return c.json(ok(reqId, { ...result.file, auditFailed }));
  },
);
