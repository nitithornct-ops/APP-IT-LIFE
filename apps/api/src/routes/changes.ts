import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import type { AppEnv, Bindings } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { randomCodeSuffix } from '../utils/recordCode';
import { cleanSearch } from '../utils/search';
import { zodValidationHook } from '../utils/validation';
import { approveChangeSchema, createChangeSchema, deployChangeSchema, listChangesQuerySchema, signOffChangeTestSchema } from '../validators/changes';

export const changesRoute = new Hono<AppEnv>();
changesRoute.use('*', requireAuth);
changesRoute.use('*', requirePermission('change.view'));

const CHANGE_SELECT =
  '*, requester:profiles!change_requests_requester_id_fkey(id, full_name, email), ' +
  'tester:profiles!change_requests_test_signoff_by_fkey(id, full_name, email), ' +
  'approver:profiles!change_requests_approver_id_fkey(id, full_name, email), ' +
  'deployer:profiles!change_requests_deploy_by_fkey(id, full_name, email), ' +
  'source_service_request:service_requests!change_requests_source_service_request_id_fkey(id, service_code, service_name, status)';

type ChangeRow = Record<string, unknown> & {
  id: string;
  change_number: string;
  title: string;
  requester_id: string;
  test_signoff_by: string | null;
  approver_id: string | null;
  status: string;
  rollback_plan: string | null;
};

function generateChangeNumber(): string {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `CHG-${date}-${randomCodeSuffix()}`;
}

async function loadChange(env: Bindings, id: string) {
  const result = await createAdminClient(env).from('change_requests').select(CHANGE_SELECT).eq('id', id).maybeSingle();
  return result as unknown as { data: ChangeRow | null; error: { message: string } | null };
}

async function auditDenied(c: Context<AppEnv>, targetId: string, action: string, reason: string) {
  await writeAuditLog(c.env, { actorId: c.get('userId'), actorEmail: c.get('userEmail'), action, module: 'change', targetTable: 'change_requests', targetId, result: 'denied', detail: { reason }, requestId: c.get('requestId') });
}

async function notifyItOperations(env: Bindings, changeId: string, title: string) {
  const admin = createAdminClient(env);
  const { data } = await admin.from('user_roles').select('user_id, roles!inner(key), profiles!inner(status)').in('roles.key', ['it_admin', 'technician']).eq('profiles.status', 'active');
  const rows = (data ?? []) as unknown as { user_id: string }[];
  await Promise.all([...new Set(rows.map((row) => row.user_id))].map((recipientId) => sendNotification(env, { recipientId, type: 'change_requested', title, link: `/changes/${changeId}` })));
}

changesRoute.get('/references', requirePermission('change.create'), async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await createAdminClient(c.env).from('service_requests').select('id, service_code, service_name, status').order('created_at', { ascending: false }).limit(500);
  if (error) return c.json(fail(reqId, 'CHANGE_REFERENCES_LOAD_FAILED', 'ดึงคำขอบริการอ้างอิงไม่สำเร็จ'), 400);
  return c.json(ok(reqId, { serviceRequests: data ?? [] }));
});

changesRoute.get('/', zValidator('query', listChangesQuerySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const { page, pageSize, search, status, riskLevel, requesterId } = c.req.valid('query');
  let query = c.get('supabase').from('change_requests').select(CHANGE_SELECT, { count: 'exact' }).order('request_date', { ascending: false }).range(...paginationRange(page, pageSize));
  if (search) {
    const safe = cleanSearch(search);
    query = query.or(`change_number.ilike.%${safe}%,title.ilike.%${safe}%,system_affected.ilike.%${safe}%`);
  }
  if (status) query = query.eq('status', status);
  if (riskLevel) query = query.eq('risk_level', riskLevel);
  if (requesterId) query = query.eq('requester_id', requesterId);
  const { data, count, error } = await query;
  if (error) return c.json(fail(reqId, 'CHANGES_LIST_FAILED', 'ดึงรายการ Change ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, toPaginatedData(data ?? [], count, page, pageSize)));
});

changesRoute.get('/:id', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;
  const [changeResult, filesResult, relationshipsResult] = await Promise.all([
    c.get('supabase').from('change_requests').select(CHANGE_SELECT).eq('id', id).maybeSingle(),
    c.get('supabase').from('file_attachments').select('id, original_filename, mime_type, size_bytes, created_at').eq('module', 'change').eq('target_table', 'change_requests').eq('target_id', id),
    c.get('supabase').from('ci_relationships').select('*').or(`and(source_type.eq.Change,source_id.eq.${id}),and(target_type.eq.Change,target_id.eq.${id})`),
  ]);
  if (changeResult.error || !changeResult.data) return c.json(fail(reqId, 'CHANGE_NOT_FOUND', 'ไม่พบ Change นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  return c.json(ok(reqId, { change: changeResult.data, attachments: filesResult.data ?? [], relationships: relationshipsResult.data ?? [] }));
});

changesRoute.post('/', requirePermission('change.create'), zValidator('json', createChangeSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');
  const result = await c.get('supabase').from('change_requests').insert({
    change_number: generateChangeNumber(), title: body.title, system_affected: body.systemAffected,
    change_type: body.changeType || null, description: body.description, requester_id: actorId,
    impact_assessment: body.impactAssessment || null, risk_level: body.riskLevel,
    rollback_plan: body.rollbackPlan || null, source_service_request_id: body.sourceServiceRequestId || null,
    notes: body.notes || null, created_by: actorId, updated_by: actorId,
  }).select(CHANGE_SELECT).single();
  const { data, error } = result as unknown as { data: ChangeRow | null; error: { message: string } | null };
  if (error) return dbFailJson(c, 'CHANGE_CREATE_FAILED', error);
  if (!data) return c.json(fail(reqId, 'CHANGE_CREATE_FAILED', 'ไม่พบข้อมูล Change หลังสร้างรายการ'), 500);
  await Promise.all([
    writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'change', targetTable: 'change_requests', targetId: data.id, detail: { changeNumber: data.change_number, riskLevel: data.risk_level }, requestId: reqId }),
    notifyItOperations(c.env, data.id, `คำขอเปลี่ยนแปลงใหม่ ${data.change_number}: ${data.title}`),
  ]);
  return c.json(ok(reqId, data), 201);
});

changesRoute.post('/:id/test-signoff', requirePermission('change.test'), zValidator('json', signOffChangeTestSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const { data: current } = await loadChange(c.env, id);
  if (!current) return c.json(fail(reqId, 'CHANGE_NOT_FOUND', 'ไม่พบ Change'), 404);
  if (current.status !== 'ยื่นคำขอ') return c.json(fail(reqId, 'CHANGE_INVALID_STATE', 'บันทึกผลทดสอบได้เฉพาะสถานะยื่นคำขอ'), 409);
  if (current.requester_id === actorId) {
    await auditDenied(c, id, 'TEST_SIGNOFF_DENIED', 'requester_cannot_test');
    return c.json(fail(reqId, 'CHANGE_SOD_VIOLATION', 'ผู้ยื่นคำขอไม่สามารถรับรองผลทดสอบรายการเดียวกันได้'), 409);
  }
  const { data, error } = await createAdminClient(c.env).from('change_requests').update({ test_result: body.result, test_passed: body.passed, test_signoff_by: actorId, test_signoff_at: new Date().toISOString(), status: body.passed ? 'ผ่านการทดสอบ' : 'ยื่นคำขอ', updated_by: actorId }).eq('id', id).select(CHANGE_SELECT).single();
  if (error) return dbFailJson(c, 'CHANGE_TEST_SIGNOFF_FAILED', error);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'TEST_SIGNOFF', module: 'change', targetTable: 'change_requests', targetId: id, detail: { passed: body.passed, result: body.result }, requestId: reqId });
  return c.json(ok(reqId, data));
});

changesRoute.post('/:id/approval', requirePermission('change.approve'), zValidator('json', approveChangeSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const { data: current } = await loadChange(c.env, id);
  if (!current) return c.json(fail(reqId, 'CHANGE_NOT_FOUND', 'ไม่พบ Change'), 404);
  if (current.status !== 'ผ่านการทดสอบ') return c.json(fail(reqId, 'CHANGE_INVALID_STATE', 'Change ต้องผ่านการทดสอบก่อนอนุมัติ'), 409);
  if (current.requester_id === actorId || current.test_signoff_by === actorId) {
    await auditDenied(c, id, 'APPROVE_DENIED', current.requester_id === actorId ? 'requester_cannot_approve' : 'tester_cannot_approve');
    return c.json(fail(reqId, 'CHANGE_SOD_VIOLATION', current.requester_id === actorId ? 'ผู้ยื่นคำขอไม่สามารถอนุมัติ Change ของตนเองได้' : 'ผู้รับรองผลทดสอบไม่สามารถเป็นผู้อนุมัติ Change รายการเดียวกันได้'), 409);
  }
  const { data, error } = await createAdminClient(c.env).from('change_requests').update({ approver_id: actorId, approve_date: new Date().toISOString(), approve_result: body.approve ? 'อนุมัติ' : 'ปฏิเสธ', approval_comment: body.comment || null, status: body.approve ? 'อนุมัติแล้ว' : 'ปฏิเสธ', updated_by: actorId }).eq('id', id).select(CHANGE_SELECT).single();
  if (error) return dbFailJson(c, 'CHANGE_APPROVAL_FAILED', error);
  await Promise.all([
    writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: body.approve ? 'APPROVE' : 'REJECT', module: 'change', targetTable: 'change_requests', targetId: id, detail: { comment: body.comment }, requestId: reqId }),
    sendNotification(c.env, { recipientId: current.requester_id, type: 'change_approval_result', title: `Change ${current.change_number} ${body.approve ? 'ได้รับอนุมัติ' : 'ถูกปฏิเสธ'}`, link: `/changes/${id}` }),
  ]);
  return c.json(ok(reqId, data));
});

changesRoute.post('/:id/deploy', requirePermission('change.deploy'), zValidator('json', deployChangeSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const { data: current } = await loadChange(c.env, id);
  if (!current) return c.json(fail(reqId, 'CHANGE_NOT_FOUND', 'ไม่พบ Change'), 404);
  if (current.status !== 'อนุมัติแล้ว') return c.json(fail(reqId, 'CHANGE_INVALID_STATE', 'Change ต้องได้รับอนุมัติก่อนติดตั้ง'), 409);
  if (current.approver_id === actorId) {
    await auditDenied(c, id, 'DEPLOY_DENIED', 'approver_cannot_deploy');
    return c.json(fail(reqId, 'CHANGE_SOD_VIOLATION', 'ผู้อนุมัติไม่สามารถเป็นผู้ติดตั้ง Change รายการเดียวกันได้'), 409);
  }
  const { data, error } = await createAdminClient(c.env).from('change_requests').update({ deploy_by: actorId, deploy_date: new Date().toISOString(), version: body.version, rollback_plan: body.rollbackPlan || current.rollback_plan, status: 'ติดตั้งใช้งานแล้ว', updated_by: actorId }).eq('id', id).select(CHANGE_SELECT).single();
  if (error) return dbFailJson(c, 'CHANGE_DEPLOY_FAILED', error);
  await Promise.all([
    writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'DEPLOY', module: 'change', targetTable: 'change_requests', targetId: id, detail: { version: body.version }, requestId: reqId }),
    sendNotification(c.env, { recipientId: current.requester_id, type: 'change_deployed', title: `Change ${current.change_number} ติดตั้งเวอร์ชัน ${body.version} แล้ว`, link: `/changes/${id}` }),
  ]);
  return c.json(ok(reqId, data));
});
