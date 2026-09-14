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
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  approveAccessRequestSchema,
  createAccessControlItemSchema,
  deactivateEmployeeSchema,
  listAccessRequestsQuerySchema,
  processAccessRequestSchema,
  revokeAccessEntrySchema,
  submitAccessRequestSchema,
  updateAccessControlItemSchema,
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

export const accessControlItemsRoute = new Hono<AppEnv>();
accessControlItemsRoute.use('*', requireAuth);

const STATUS = {
  PENDING_APPROVE: 'รออนุมัติจากหัวหน้างาน',
  PENDING_IT: 'รอส่วนงานไอทีดำเนินการ',
  DONE: 'เสร็จสิ้น',
  REJECTED: 'ปฏิเสธ',
} as const;

const REVIEW_CYCLE_DAYS = 180;
const REQUEST_TYPE_REVOKE = 'เพิกถอนสิทธิ์';
const ACCESS_ACTIONS = ['read', 'create', 'update', 'delete', 'approve'] as const;
type AccessAction = (typeof ACCESS_ACTIONS)[number];

function reviewDueIso(expiresAt: string | null | undefined): string {
  const reviewDate = new Date();
  reviewDate.setDate(reviewDate.getDate() + REVIEW_CYCLE_DAYS);
  if (expiresAt) {
    const expiry = new Date(expiresAt);
    if (expiry < reviewDate) return expiry.toISOString();
  }
  return reviewDate.toISOString();
}

function hasOnlyAllowedActions(actions: string[], allowed: string[]): boolean {
  return actions.every((action) => ACCESS_ACTIONS.includes(action as AccessAction) && allowed.includes(action));
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

accessRequestsRoute.get(
  '/subject-options',
  requireAnyPermission(['access_request.process', 'access_registry.manage', 'user.manage']),
  async (c) => {
    const reqId = c.get('requestId');
    const { data, error } = await createAdminClient(c.env)
      .from('profiles')
      .select('id, full_name, email, status')
      .order('full_name', { ascending: true })
      .limit(1000);
    if (error) return c.json(fail(reqId, 'ACCESS_SUBJECT_OPTIONS_FAILED', 'ดึงรายชื่อผู้รับสิทธิ์ไม่สำเร็จ'), 400);
    return c.json(ok(reqId, data));
  },
);

accessRequestsRoute.get('/', zValidator('query', listAccessRequestsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const { page, pageSize, status, mine, pendingMyApproval } = c.req.valid('query');

  let query = supabase
    .from('access_requests')
    .select('id, requester_id, subject_user_id, system_id, access_level, access_item_id, requested_actions, request_type, lifecycle_event, temporary_access, start_at, expires_at, data_classification, privileged_access, status, approver_id, created_at, access_systems(name), access_control_item:access_control_items!access_requests_access_item_id_fkey(kind, code, name)', {
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
      '*, access_systems(name), access_control_item:access_control_items!access_requests_access_item_id_fkey(kind, code, name, description, permission_actions, data_classification, privileged_access), requester:profiles!access_requests_requester_id_fkey(full_name, email), subject_user:profiles!access_requests_subject_user_id_fkey(full_name, email), approver:profiles!access_requests_approver_id_fkey(full_name, email), system_owner:profiles!access_requests_system_owner_id_fkey(full_name, email), it_handler:profiles!access_requests_it_handler_id_fkey(full_name, email)',
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
    const subjectUserId = body.subjectUserId ?? actorId;

    if (subjectUserId !== actorId) {
      const canCreateForOthers = (await hasPerm(c, 'access_request.process'))
        || (await hasPerm(c, 'access_registry.manage'))
        || (await hasPerm(c, 'user.manage'));
      if (!canCreateForOthers) {
        return c.json(fail(reqId, 'ACCESS_REQUEST_SUBJECT_FORBIDDEN', 'ท่านไม่มีสิทธิ์ยื่นคำขอแทนผู้ใช้อื่น'), 403);
      }
    }

    const { data: system, error: systemError } = await supabase
      .from('access_systems')
      .select('id, name, status')
      .eq('id', body.systemId)
      .eq('status', 'active')
      .maybeSingle();
    if (systemError || !system) {
      return c.json(fail(reqId, 'ACCESS_SYSTEM_INVALID', 'กรุณาเลือกระบบงานที่เปิดใช้งานอยู่'), 400);
    }

    const { data: accessItem, error: accessItemError } = await supabase
      .from('access_control_items')
      .select('id, system_id, kind, code, name, permission_actions, data_classification, privileged_access, system_owner_id, default_approver_id, status')
      .eq('id', body.accessItemId)
      .eq('system_id', body.systemId)
      .eq('status', 'active')
      .maybeSingle();
    if (accessItemError || !accessItem) {
      return c.json(fail(reqId, 'ACCESS_ITEM_INVALID', 'Role / Profile / Group / Entitlement นี้ไม่พร้อมให้ขอสิทธิ์'), 400);
    }
    if (!hasOnlyAllowedActions(body.requestedActions, accessItem.permission_actions ?? [])) {
      return c.json(fail(reqId, 'ACCESS_ACTION_NOT_ALLOWED', 'รายการ action ที่ขอไม่อยู่ในขอบเขตของสิทธิ์นี้'), 400);
    }

    const { data: subject, error: subjectError } = await supabase
      .from('profiles')
      .select('id, supervisor_id, status')
      .eq('id', subjectUserId)
      .maybeSingle();
    if (subjectError || !subject || (body.lifecycleEvent !== 'leaver' && subject.status !== 'active')) {
      return c.json(fail(reqId, 'ACCESS_REQUEST_SUBJECT_INVALID', 'ไม่พบผู้รับสิทธิ์ในทะเบียน หรือสถานะผู้รับสิทธิ์ไม่ถูกต้องสำหรับ Lifecycle นี้'), 400);
    }

    const requestType = body.requestType ?? 'ขอเพิ่มสิทธิ์';
    if (body.lifecycleEvent === 'joiner' && requestType === REQUEST_TYPE_REVOKE) {
      return c.json(fail(reqId, 'ACCESS_LIFECYCLE_INVALID', 'Joiner ต้องเป็นคำขอเพิ่มสิทธิ์'), 400);
    }
    if (body.lifecycleEvent === 'leaver' && requestType !== REQUEST_TYPE_REVOKE) {
      return c.json(fail(reqId, 'ACCESS_LIFECYCLE_INVALID', 'Leaver ต้องเป็นคำขอเพิกถอนสิทธิ์'), 400);
    }

    const approverId = accessItem.default_approver_id ?? subject.supervisor_id;
    if (!approverId) {
      return c.json(
        fail(reqId, 'SUPERVISOR_NOT_SET', 'ยังไม่ได้กำหนดหัวหน้างานของท่านในทะเบียนผู้ใช้ กรุณาติดต่อส่วนงานไอที'),
        400,
      );
    }
    const { data: supervisor, error: supervisorError } = await supabase
      .from('profiles')
      .select('id, status')
      .eq('id', approverId)
      .maybeSingle();
    if (supervisorError || !supervisor || supervisor.status !== 'active') {
      return c.json(fail(reqId, 'SUPERVISOR_INACTIVE', 'บัญชีหัวหน้างานของท่านไม่ใช่บัญชีที่ใช้งานอยู่ กรุณาติดต่อส่วนงานไอที'), 400);
    }
    if (supervisor.id === subjectUserId || supervisor.id === actorId) {
      return c.json(fail(reqId, 'ACCESS_REQUEST_SOD_CONFLICT', 'SoD ไม่อนุญาตให้ผู้รับสิทธิ์หรือผู้ยื่นคำขอเป็นผู้อนุมัติรายการเดียวกัน'), 409);
    }

    const startAt = body.startAt ?? new Date().toISOString();
    const expiresAt = body.expiresAt ?? null;

    const { data: request, error } = await supabase
      .from('access_requests')
      .insert({
        requester_id: actorId,
        subject_user_id: subjectUserId,
        system_id: body.systemId,
        access_item_id: body.accessItemId,
        access_level: null,
        requested_actions: body.requestedActions,
        temporary_access: body.temporaryAccess,
        start_at: startAt,
        expires_at: expiresAt,
        data_classification: accessItem.data_classification,
        privileged_access: accessItem.privileged_access,
        reason: body.businessReason,
        business_reason: body.businessReason,
        request_type: requestType,
        approver_id: supervisor.id,
        system_owner_id: accessItem.system_owner_id,
        lifecycle_event: body.lifecycleEvent,
        status: STATUS.PENDING_APPROVE,
        created_by: actorId,
      })
      .select()
      .single();

    if (error) {
      return dbFailJson(c, 'ACCESS_REQUEST_CREATE_FAILED', error);
    }

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE',
      module: 'access_request',
      targetTable: 'access_requests',
      targetId: request.id,
      detail: {
        systemId: body.systemId,
        accessItemId: body.accessItemId,
        requestedActions: body.requestedActions,
        temporaryAccess: body.temporaryAccess,
        lifecycleEvent: body.lifecycleEvent,
      },
      requestId: reqId,
    });

    await sendNotification(c.env, {
      recipientId: supervisor.id,
      type: 'access_request_approval_needed',
      title: `มีคำขอสิทธิ์รออนุมัติ: ${system.name} · ${accessItem.name}`,
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
      return dbFailJson(c, 'ACCESS_REQUEST_APPROVAL_FAILED', error);
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

    const subjectUserId = current.subject_user_id ?? current.requester_id;

    if (body.success && current.request_type !== REQUEST_TYPE_REVOKE) {
      let duplicateQuery = supabase
        .from('user_access_registry')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', subjectUserId)
        .eq('status', 'active');
      duplicateQuery = current.access_item_id
        ? duplicateQuery.eq('access_item_id', current.access_item_id)
        : duplicateQuery.eq('system_id', current.system_id).eq('access_level', current.access_level);
      const { count: duplicateCount } = await duplicateQuery;
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
        evidence_after_grant: body.evidence ?? null,
        status: body.success ? STATUS.DONE : STATUS.PENDING_IT,
        review_due: body.success && current.request_type !== REQUEST_TYPE_REVOKE ? reviewDueIso(current.expires_at) : null,
        updated_by: actorId,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return dbFailJson(c, 'ACCESS_REQUEST_PROCESS_FAILED', error);
    }

    if (body.success) {
      if (current.request_type === REQUEST_TYPE_REVOKE) {
        const revokeQuery = current.access_item_id
          ? supabase
            .from('user_access_registry')
            .update({ status: 'revoked', notes: `เพิกถอนตามคำขอ ${id}`, updated_by: actorId })
            .eq('user_id', subjectUserId)
            .eq('access_item_id', current.access_item_id)
            .eq('status', 'active')
          : supabase
            .from('user_access_registry')
            .update({ status: 'revoked', notes: `เพิกถอนตามคำขอ ${id}`, updated_by: actorId })
            .eq('user_id', subjectUserId)
            .eq('system_id', current.system_id)
            .eq('status', 'active');
        const { error: revokeError } = await revokeQuery;
        if (revokeError) return dbFailJson(c, 'ACCESS_REGISTRY_REVOKE_FAILED', revokeError);
      } else {
        const { error: grantError } = await supabase.from('user_access_registry').insert({
          user_id: subjectUserId,
          system_id: current.system_id,
          access_item_id: current.access_item_id,
          access_level: current.access_level,
          permission_actions: current.requested_actions ?? [],
          temporary_access: current.temporary_access,
          start_at: current.start_at,
          expires_at: current.expires_at,
          data_classification: current.data_classification,
          privileged_access: current.privileged_access,
          business_reason: current.business_reason ?? current.reason,
          system_owner_id: current.system_owner_id,
          approved_by: approvedBy,
          lifecycle_event: current.lifecycle_event,
          evidence_after_grant: body.evidence ?? null,
          granted_by: actorId,
          grant_date: now,
          last_review_date: now,
          next_review_due: reviewDueIso(current.expires_at),
          status: current.start_at && new Date(current.start_at) > new Date() ? 'scheduled' : 'active',
          source_request_id: id,
          created_by: actorId,
        });
        if (grantError) return dbFailJson(c, 'ACCESS_REGISTRY_GRANT_FAILED', grantError);
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

const ACCESS_ITEM_SELECT = '*, access_systems(name), system_owner:profiles!access_control_items_system_owner_id_fkey(full_name, email), default_approver:profiles!access_control_items_default_approver_id_fkey(full_name, email)';

accessControlItemsRoute.get('/', requireAnyPermission(['access_request.view', 'access_system.manage']), async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await c.get('supabase')
    .from('access_control_items')
    .select(ACCESS_ITEM_SELECT)
    .order('name', { ascending: true });
  if (error) return c.json(fail(reqId, 'ACCESS_ITEMS_LIST_FAILED', 'ดึงรายการ Role / Profile / Group / Entitlement ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data));
});

accessControlItemsRoute.get('/people', requirePermission('access_system.manage'), async (c) => {
  const reqId = c.get('requestId');
  const { data, error } = await createAdminClient(c.env)
    .from('profiles')
    .select('id, full_name, email, status')
    .eq('status', 'active')
    .order('full_name', { ascending: true })
    .limit(1000);
  if (error) return c.json(fail(reqId, 'ACCESS_ITEM_PEOPLE_FAILED', 'ดึงรายชื่อ System Owner / Approver ไม่สำเร็จ'), 400);
  return c.json(ok(reqId, data));
});

accessControlItemsRoute.post(
  '/',
  requirePermission('access_system.manage'),
  zValidator('json', createAccessControlItemSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');

    const { data: system } = await supabase.from('access_systems').select('id').eq('id', body.systemId).eq('status', 'active').maybeSingle();
    if (!system) return c.json(fail(reqId, 'ACCESS_SYSTEM_INVALID', 'กรุณาเลือกระบบงานที่เปิดใช้งานอยู่'), 400);

    const profileIds = [body.systemOwnerId, body.defaultApproverId].filter((id): id is string => Boolean(id));
    const { data: people, error: peopleError } = await supabase.from('profiles').select('id').in('id', profileIds).eq('status', 'active');
    if (peopleError || (people?.length ?? 0) !== new Set(profileIds).size) {
      return c.json(fail(reqId, 'ACCESS_ITEM_OWNER_INVALID', 'System Owner หรือ Approver ต้องเป็นบัญชีที่ใช้งานอยู่'), 400);
    }

    const { data, error } = await supabase
      .from('access_control_items')
      .insert({
        system_id: body.systemId,
        kind: body.kind,
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        permission_actions: body.permissionActions,
        data_classification: body.dataClassification,
        privileged_access: body.privilegedAccess,
        system_owner_id: body.systemOwnerId,
        default_approver_id: body.defaultApproverId ?? null,
        created_by: actorId,
      })
      .select(ACCESS_ITEM_SELECT)
      .single();
    if (error) return dbFailJson(c, 'ACCESS_ITEM_CREATE_FAILED', error);

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE',
      module: 'access_control_item',
      targetTable: 'access_control_items',
      targetId: data.id,
      detail: { systemId: body.systemId, kind: body.kind, code: body.code, privilegedAccess: body.privilegedAccess },
      requestId: reqId,
    });
    return c.json(ok(reqId, data), 201);
  },
);

accessControlItemsRoute.patch(
  '/:id',
  requirePermission('access_system.manage'),
  zValidator('json', updateAccessControlItemSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const patch: Record<string, unknown> = { updated_by: actorId };
    if (body.kind !== undefined) patch.kind = body.kind;
    if (body.code !== undefined) patch.code = body.code;
    if (body.name !== undefined) patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (body.permissionActions !== undefined) patch.permission_actions = body.permissionActions;
    if (body.dataClassification !== undefined) patch.data_classification = body.dataClassification;
    if (body.privilegedAccess !== undefined) patch.privileged_access = body.privilegedAccess;
    if (body.systemOwnerId !== undefined) patch.system_owner_id = body.systemOwnerId;
    if (body.defaultApproverId !== undefined) patch.default_approver_id = body.defaultApproverId;
    if (body.status !== undefined) patch.status = body.status;

    const profileIds = [body.systemOwnerId, body.defaultApproverId].filter((profileId): profileId is string => Boolean(profileId));
    if (profileIds.length) {
      const { data: people, error: peopleError } = await supabase.from('profiles').select('id').in('id', profileIds).eq('status', 'active');
      if (peopleError || (people?.length ?? 0) !== new Set(profileIds).size) {
        return c.json(fail(reqId, 'ACCESS_ITEM_OWNER_INVALID', 'System Owner หรือ Approver ต้องเป็นบัญชีที่ใช้งานอยู่'), 400);
      }
    }

    const { data, error } = await supabase.from('access_control_items').update(patch).eq('id', id).select(ACCESS_ITEM_SELECT).single();
    if (error) return dbFailJson(c, 'ACCESS_ITEM_UPDATE_FAILED', error);
    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE',
      module: 'access_control_item',
      targetTable: 'access_control_items',
      targetId: id,
      detail: body,
      requestId: reqId,
    });
    return c.json(ok(reqId, data));
  },
);

accessRegistryRoute.get('/', requireAnyPermission(['access_request.view', 'access_registry.manage']), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');

  const { data, error } = await supabase
    .from('user_access_registry')
    .select('*, access_systems(name), access_control_item:access_control_items!user_access_registry_access_item_id_fkey(kind, code, name), user:profiles!user_access_registry_user_id_fkey(full_name, email), system_owner:profiles!user_access_registry_system_owner_id_fkey(full_name, email), approver:profiles!user_access_registry_approved_by_fkey(full_name, email), operator:profiles!user_access_registry_granted_by_fkey(full_name, email)')
    .order('created_at', { ascending: false, nullsFirst: false });

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

  const { data: current, error: currentError } = await supabase
    .from('user_access_registry')
    .select('expires_at')
    .eq('id', id)
    .maybeSingle();
  if (currentError || !current) return c.json(fail(reqId, 'ACCESS_REGISTRY_NOT_FOUND', 'ไม่พบรายการสิทธิ์ในทะเบียน'), 404);

  const { data, error } = await supabase
    .from('user_access_registry')
    .update({ last_review_date: now, next_review_due: reviewDueIso(current.expires_at), updated_by: actorId })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return dbFailJson(c, 'ACCESS_REGISTRY_REVIEW_FAILED', error);
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
      return dbFailJson(c, 'ACCESS_REGISTRY_REVOKE_FAILED', error);
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

    const { error: authStatusError } = await admin.auth.admin.updateUserById(body.userId, { ban_duration: '876000h' });
    if (authStatusError) {
      return c.json(fail(reqId, 'EMPLOYEE_AUTH_DEACTIVATE_FAILED', 'ระงับบัญชีเข้าสู่ระบบไม่สำเร็จ'), 502);
    }

    const { data: deactivationResult, error: deactivationError } = await admin.rpc('deactivate_user_access', {
      user_id_input: body.userId,
      actor_id_input: actorId,
      actor_email_input: c.get('userEmail'),
      reason_input: body.reason,
      request_id_input: reqId,
    });
    if (deactivationError) {
      const rollback = await admin.auth.admin.updateUserById(body.userId, { ban_duration: 'none' });
      if (rollback.error) {
        console.error(JSON.stringify({ requestId: reqId, code: 'EMPLOYEE_AUTH_DEACTIVATE_ROLLBACK_FAILED', targetId: body.userId }));
      }
      return dbFailJson(c, 'EMPLOYEE_DEACTIVATE_FAILED', deactivationError);
    }

    const suspendedCount = Number(
      (deactivationResult as { suspendedCount?: number } | null)?.suspendedCount ?? 0,
    );

    await notifyItAdmins(c.env, {
      type: 'employee_access_suspended',
      title: `ระงับสิทธิ์ผู้พ้นสภาพ (${suspendedCount} รายการ)`,
    });

    return c.json(ok(reqId, { deactivated: true, suspendedCount }));
  },
);
