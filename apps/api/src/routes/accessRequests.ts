import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import type { AppEnv, Bindings } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  approveAccessRequestSchema,
  deactivateEmployeeSchema,
  listAccessRequestsQuerySchema,
  processAccessRequestSchema,
  revokeAccessEntrySchema,
  submitAccessRequestSchema,
} from '../validators/accessRequests';

/**
 * คำขอสิทธิ์ระบบ (Access Request) — สืบทอดจาก AccessRequests/UserAccessRegistry เดิม
 * (Module_AccessControl.gs) Workflow: ผู้ใช้ยื่นคำขอ → หัวหน้างาน (profiles.supervisor_id) อนุมัติ →
 * IT ดำเนินการ → บันทึกสิทธิ์ + ตั้งรอบทบทวน ขอบเขตที่ตัดออกอธิบายไว้ใน header comment ของ
 * supabase/migrations/20260812100000_access_requests.sql
 */
export const accessRequestsRoute = new Hono<AppEnv>();
accessRequestsRoute.use('*', requireAuth);

export const accessRegistryRoute = new Hono<AppEnv>();
accessRegistryRoute.use('*', requireAuth);

const STATUS = {
  PENDING_APPROVE: 'รออนุมัติจากหัวหน้างาน',
  PENDING_IT: 'รอส่วนงานไอทีดำเนินการ',
  DONE: 'เสร็จสิ้น',
  REJECTED: 'ปฏิเสธ',
} as const;

const REVIEW_CYCLE_DAYS = 180;
const REQUEST_TYPE_REVOKE = 'เพิกถอนสิทธิ์';

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function hasPerm(c: Context<AppEnv>, permissionKey: string): Promise<boolean> {
  const { data, error } = await c.get('supabase').rpc('has_permission', { permission_key_input: permissionKey });
  return !error && data === true;
}

/** ผู้มีบทบาท it_admin/super_admin ที่ Active ทั้งหมด — ต้องใช้ Admin client เพราะ user_roles ของ
 * "คนอื่น" อ่านได้เฉพาะผู้มี role.view/role.manage (ผู้อนุมัติทั่วไปที่ยื่น/อนุมัติคำขอไม่มีสิทธิ์นี้) */
async function notifyItAdmins(env: Bindings, input: { type: string; title: string; link?: string }): Promise<void> {
  const admin = createAdminClient(env);
  const { data } = await admin
    .from('user_roles')
    .select('user_id, roles!inner(key), profiles!inner(status)')
    .in('roles.key', ['it_admin', 'super_admin'])
    .eq('profiles.status', 'active');
  const uniqueUserIds = [...new Set((data ?? []).map((row) => row.user_id as string))];
  for (const userId of uniqueUserIds) {
    await sendNotification(env, { recipientId: userId, type: input.type, title: input.title, link: input.link ?? null });
  }
}

accessRequestsRoute.get('/', zValidator('query', listAccessRequestsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const { page, pageSize, status, mine, pendingMyApproval } = c.req.valid('query');

  let query = supabase
    .from('access_requests')
    .select('id, requester_id, system_id, access_level, request_type, status, approver_id, created_at, access_systems(name)', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(...paginationRange(page, pageSize));

  if (status) query = query.eq('status', status);
  if (mine === 'true') query = query.eq('requester_id', actorId);
  if (pendingMyApproval === 'true') {
    query = query.eq('approver_id', actorId).eq('status', STATUS.PENDING_APPROVE);
  }

  const { data, count, error } = await query;
  if (error) {
    return c.json(fail(reqId, 'ACCESS_REQUESTS_LIST_FAILED', 'ดึงรายการคำขอสิทธิ์ไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, toPaginatedData(data, count, page, pageSize)));
});

accessRequestsRoute.get('/:id', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id');

  const { data, error } = await supabase
    .from('access_requests')
    .select(
      '*, access_systems(name), requester:profiles!access_requests_requester_id_fkey(full_name, email), approver:profiles!access_requests_approver_id_fkey(full_name, email), it_handler:profiles!access_requests_it_handler_id_fkey(full_name, email)',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return c.json(fail(reqId, 'ACCESS_REQUEST_LOAD_FAILED', 'ดึงข้อมูลคำขอสิทธิ์ไม่สำเร็จ'), 400);
  }
  if (!data) {
    return c.json(fail(reqId, 'ACCESS_REQUEST_NOT_FOUND', 'ไม่พบคำขอสิทธิ์นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }
  return c.json(ok(reqId, data));
});

accessRequestsRoute.post(
  '/',
  requirePermission('access_request.create'),
  zValidator('json', submitAccessRequestSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');

    const { data: system, error: systemError } = await supabase
      .from('access_systems')
      .select('*')
      .eq('id', body.systemId)
      .eq('status', 'active')
      .maybeSingle();
    if (systemError || !system) {
      return c.json(fail(reqId, 'ACCESS_SYSTEM_INVALID', 'กรุณาเลือกระบบงานที่เปิดใช้งานอยู่'), 400);
    }

    const { data: me, error: meError } = await supabase.from('profiles').select('supervisor_id').eq('id', actorId).maybeSingle();
    if (meError || !me?.supervisor_id) {
      return c.json(
        fail(reqId, 'SUPERVISOR_NOT_SET', 'ยังไม่ได้กำหนดหัวหน้างานของท่านในทะเบียนผู้ใช้ กรุณาติดต่อส่วนงานไอที'),
        400,
      );
    }
    const { data: supervisor, error: supervisorError } = await supabase
      .from('profiles')
      .select('id, status')
      .eq('id', me.supervisor_id)
      .maybeSingle();
    if (supervisorError || !supervisor || supervisor.status !== 'active') {
      return c.json(fail(reqId, 'SUPERVISOR_INACTIVE', 'บัญชีหัวหน้างานของท่านไม่ใช่บัญชีที่ใช้งานอยู่ กรุณาติดต่อส่วนงานไอที'), 400);
    }

    const { data: request, error } = await supabase
      .from('access_requests')
      .insert({
        requester_id: actorId,
        system_id: body.systemId,
        access_level: body.accessLevel,
        reason: body.reason,
        request_type: body.requestType ?? 'ขอเพิ่มสิทธิ์',
        approver_id: supervisor.id,
        status: STATUS.PENDING_APPROVE,
        created_by: actorId,
      })
      .select()
      .single();

    if (error) {
      return c.json(fail(reqId, 'ACCESS_REQUEST_CREATE_FAILED', error.message), 400);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE',
      module: 'access_request',
      targetTable: 'access_requests',
      targetId: request.id,
      detail: { systemId: body.systemId, accessLevel: body.accessLevel },
      requestId: reqId,
    });

    await sendNotification(c.env, {
      recipientId: supervisor.id,
      type: 'access_request_approval_needed',
      title: `มีคำขอสิทธิ์รออนุมัติ: ${system.name} (${body.accessLevel})`,
      link: `/access-requests/${request.id}`,
    });

    return c.json(ok(reqId, request), 201);
  },
);

accessRequestsRoute.post(
  '/:id/approve',
  zValidator('json', approveAccessRequestSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const { data: current, error: currentError } = await supabase.from('access_requests').select('*').eq('id', id).maybeSingle();
    if (currentError || !current) {
      return c.json(fail(reqId, 'ACCESS_REQUEST_NOT_FOUND', 'ไม่พบคำขอสิทธิ์นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
    }
    if (current.status !== STATUS.PENDING_APPROVE) {
      return c.json(fail(reqId, 'ACCESS_REQUEST_NOT_PENDING_APPROVE', 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ'), 400);
    }
    if (current.requester_id === actorId) {
      return c.json(fail(reqId, 'PERMISSION_DENIED', 'ไม่สามารถอนุมัติคำขอสิทธิ์ของตนเองได้'), 403);
    }
    const authorized = current.approver_id === actorId || (await hasPerm(c, 'access_request.approve'));
    if (!authorized) {
      return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่ใช่ผู้อนุมัติที่ได้รับมอบหมายสำหรับคำขอนี้'), 403);
    }

    const newStatus = body.approved ? STATUS.PENDING_IT : STATUS.REJECTED;
    const { data: updated, error } = await supabase
      .from('access_requests')
      .update({
        approved: body.approved,
        approved_by: actorId,
        approved_at: new Date().toISOString(),
        approval_comment: body.comment ?? null,
        status: newStatus,
        updated_by: actorId,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return c.json(fail(reqId, 'ACCESS_REQUEST_APPROVAL_FAILED', error.message), 400);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: body.approved ? 'APPROVE' : 'REJECT',
      module: 'access_request',
      targetTable: 'access_requests',
      targetId: id,
      detail: body,
      requestId: reqId,
    });

    if (body.approved) {
      await notifyItAdmins(c.env, {
        type: 'access_request_pending_it',
        title: `คำขอสิทธิ์ผ่านการอนุมัติ รอไอทีดำเนินการ (${id})`,
        link: `/access-requests/${id}`,
      });
    }
    await sendNotification(c.env, {
      recipientId: current.requester_id,
      type: body.approved ? 'access_request_approved' : 'access_request_rejected',
      title: `ผลการพิจารณาคำขอสิทธิ์: ${body.approved ? 'อนุมัติแล้ว' : 'ถูกปฏิเสธ'}`,
      link: `/access-requests/${id}`,
    });

    return c.json(ok(reqId, updated));
  },
);

accessRequestsRoute.post(
  '/:id/process',
  requirePermission('access_request.process'),
  zValidator('json', processAccessRequestSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const { data: current, error: currentError } = await supabase.from('access_requests').select('*').eq('id', id).maybeSingle();
    if (currentError || !current) {
      return c.json(fail(reqId, 'ACCESS_REQUEST_NOT_FOUND', 'ไม่พบคำขอสิทธิ์นี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
    }
    if (current.status !== STATUS.PENDING_IT) {
      return c.json(fail(reqId, 'ACCESS_REQUEST_NOT_PENDING_IT', 'คำขอนี้ยังไม่ผ่านการอนุมัติ'), 400);
    }
    const approvedBy = current.approved_by ?? current.approver_id;
    if (approvedBy === actorId) {
      return c.json(fail(reqId, 'PERMISSION_DENIED', 'ผู้อนุมัติไม่สามารถเป็นผู้ดำเนินการให้สิทธิ์รายการเดียวกันได้'), 403);
    }

    if (body.success && current.request_type !== REQUEST_TYPE_REVOKE) {
      const { count: duplicateCount } = await supabase
        .from('user_access_registry')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', current.requester_id)
        .eq('system_id', current.system_id)
        .eq('access_level', current.access_level)
        .eq('status', 'active');
      if ((duplicateCount ?? 0) > 0) {
        return c.json(fail(reqId, 'ACCESS_ALREADY_GRANTED', 'ผู้ใช้นี้มีสิทธิ์ระดับเดียวกันในระบบงานนี้อยู่แล้ว'), 400);
      }
    }

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from('access_requests')
      .update({
        it_handler_id: actorId,
        it_action_at: now,
        it_success: body.success,
        it_comment: body.comment ?? null,
        status: body.success ? STATUS.DONE : STATUS.PENDING_IT,
        review_due: body.success ? addDaysIso(REVIEW_CYCLE_DAYS) : null,
        updated_by: actorId,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return c.json(fail(reqId, 'ACCESS_REQUEST_PROCESS_FAILED', error.message), 400);
    }

    if (body.success) {
      if (current.request_type === REQUEST_TYPE_REVOKE) {
        await supabase
          .from('user_access_registry')
          .update({ status: 'revoked', notes: `เพิกถอนตามคำขอ ${id}`, updated_by: actorId })
          .eq('user_id', current.requester_id)
          .eq('system_id', current.system_id)
          .eq('status', 'active');
      } else {
        await supabase.from('user_access_registry').insert({
          user_id: current.requester_id,
          system_id: current.system_id,
          access_level: current.access_level,
          granted_by: actorId,
          grant_date: now,
          last_review_date: now,
          next_review_due: addDaysIso(REVIEW_CYCLE_DAYS),
          status: 'active',
          source_request_id: id,
          created_by: actorId,
        });
      }
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'IT_PROCESS',
      module: 'access_request',
      targetTable: 'access_requests',
      targetId: id,
      detail: body,
      requestId: reqId,
    });

    await sendNotification(c.env, {
      recipientId: current.requester_id,
      type: body.success ? 'access_request_completed' : 'access_request_failed',
      title: `คำขอสิทธิ์ ${body.success ? 'ดำเนินการเสร็จสิ้น' : 'ดำเนินการไม่สำเร็จ'}`,
      link: `/access-requests/${id}`,
    });

    return c.json(ok(reqId, updated));
  },
);

accessRegistryRoute.get('/', requireAnyPermission(['access_request.view', 'access_registry.manage']), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');

  const { data, error } = await supabase
    .from('user_access_registry')
    .select('*, access_systems(name), user:profiles!user_access_registry_user_id_fkey(full_name, email)')
    .order('next_review_due', { ascending: true, nullsFirst: false });

  if (error) {
    return c.json(fail(reqId, 'ACCESS_REGISTRY_LIST_FAILED', 'ดึงทะเบียนสิทธิ์ไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, data));
});

accessRegistryRoute.post('/:id/review', requirePermission('access_registry.manage'), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id');
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('user_access_registry')
    .update({ last_review_date: now, next_review_due: addDaysIso(REVIEW_CYCLE_DAYS), updated_by: actorId })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return c.json(fail(reqId, 'ACCESS_REGISTRY_REVIEW_FAILED', error.message), 400);
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'REVIEW',
    module: 'access_registry',
    targetTable: 'user_access_registry',
    targetId: id,
    requestId: reqId,
  });

  return c.json(ok(reqId, data));
});

accessRegistryRoute.post(
  '/:id/revoke',
  requirePermission('access_registry.manage'),
  zValidator('json', revokeAccessEntrySchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('user_access_registry')
      .update({ status: 'revoked', notes: body.reason, updated_by: actorId })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return c.json(fail(reqId, 'ACCESS_REGISTRY_REVOKE_FAILED', error.message), 400);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'REVOKE',
      module: 'access_registry',
      targetTable: 'user_access_registry',
      targetId: id,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, data));
  },
);

/**
 * ระงับสิทธิ์ทั้งหมดเมื่อพนักงานพ้นสภาพ — ใช้ Admin client เพราะ access_registry.manage ไม่ได้
 * แปลว่ามี user.manage เสมอไป (คนละ permission กัน) แต่ IT ที่ดูแลทะเบียนสิทธิ์ต้องระงับบัญชีได้จริง
 * ตามพฤติกรรมเดิม (ระบบเดิมใช้ role IT_ADMIN เดียวทำทุกอย่าง ระบบใหม่แยก permission ละเอียดกว่า)
 */
accessRegistryRoute.post(
  '/deactivate',
  requirePermission('access_registry.manage'),
  zValidator('json', deactivateEmployeeSchema, zodValidationHook),
  async (c) => {
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');
    const admin = createAdminClient(c.env);

    const { error: profileError } = await admin.from('profiles').update({ status: 'inactive', updated_by: actorId }).eq('id', body.userId);
    if (profileError) {
      return c.json(fail(reqId, 'EMPLOYEE_DEACTIVATE_FAILED', profileError.message), 400);
    }

    const { data: suspended, error: registryError } = await admin
      .from('user_access_registry')
      .update({ status: 'suspended', notes: `พ้นสภาพ: ${body.reason}`, updated_by: actorId })
      .eq('user_id', body.userId)
      .eq('status', 'active')
      .select('id');

    if (registryError) {
      return c.json(fail(reqId, 'ACCESS_SUSPEND_FAILED', registryError.message), 400);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'DEACTIVATE_USER',
      module: 'access_registry',
      targetTable: 'profiles',
      targetId: body.userId,
      detail: { reason: body.reason, suspendedCount: suspended?.length ?? 0 },
      requestId: reqId,
    });

    await notifyItAdmins(c.env, {
      type: 'employee_access_suspended',
      title: `ระงับสิทธิ์ผู้พ้นสภาพ (${suspended?.length ?? 0} รายการ)`,
    });

    return c.json(ok(reqId, { deactivated: true, suspendedCount: suspended?.length ?? 0 }));
  },
);
