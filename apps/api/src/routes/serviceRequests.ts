import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { loadAuditSnapshot, writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import type { AppEnv } from '../types';
import { paginationRange, toPaginatedData } from '../utils/pagination';
import { dbFailJson } from '../utils/dbError';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  approveServiceRequestSchema,
  listServiceRequestsQuerySchema,
  submitServiceRequestSchema,
  updateServiceRequestSchema,
  updateServiceRequestTaskSchema,
} from '../validators/serviceRequests';

/**
 * คำขอบริการ (Service Request) — สืบทอดจาก ServiceRequests/ServiceRequestTasks/
 * ServiceRequestHistory เดิม (Module_ServiceCatalog.gs) ขอบเขตที่ตัดออกอธิบายไว้ใน header comment
 * ของ supabase/migrations/20260811100000_service_catalog.sql — การอนุมัติใช้ "กลุ่มอนุมัติ"
 * (approval_groups จาก Module 2) แทนอีเมลผู้อนุมัติคนเดียวแบบระบบเดิม
 */
export const serviceRequestsRoute = new Hono<AppEnv>();
serviceRequestsRoute.use('*', requireAuth);

const STATUS = {
  PENDING_APPROVAL: 'รออนุมัติ',
  PENDING_ASSIGNMENT: 'รอมอบหมาย',
  IN_PROGRESS: 'กำลังดำเนินการ',
  WAITING_USER: 'รอผู้ใช้งาน',
  WAITING_VENDOR: 'รอผู้ให้บริการ',
  PENDING_CONFIRMATION: 'รอยืนยันผล',
  CLOSED: 'ปิดงาน',
  REJECTED: 'ปฏิเสธ',
  CANCELLED: 'ยกเลิก',
} as const;

const FINALIZING_STATUSES: string[] = [STATUS.PENDING_CONFIRMATION, STATUS.CLOSED];

const TRANSITIONS: Record<string, string[]> = {
  [STATUS.PENDING_APPROVAL]: [STATUS.PENDING_ASSIGNMENT, STATUS.REJECTED, STATUS.CANCELLED],
  [STATUS.PENDING_ASSIGNMENT]: [STATUS.IN_PROGRESS, STATUS.CANCELLED],
  [STATUS.IN_PROGRESS]: [STATUS.WAITING_USER, STATUS.WAITING_VENDOR, STATUS.PENDING_CONFIRMATION, STATUS.CLOSED, STATUS.CANCELLED],
  [STATUS.WAITING_USER]: [STATUS.IN_PROGRESS, STATUS.WAITING_VENDOR, STATUS.PENDING_CONFIRMATION, STATUS.CLOSED, STATUS.CANCELLED],
  [STATUS.WAITING_VENDOR]: [STATUS.IN_PROGRESS, STATUS.WAITING_USER, STATUS.PENDING_CONFIRMATION, STATUS.CLOSED, STATUS.CANCELLED],
  [STATUS.PENDING_CONFIRMATION]: [STATUS.IN_PROGRESS, STATUS.CLOSED],
  [STATUS.CLOSED]: [],
  [STATUS.REJECTED]: [],
  [STATUS.CANCELLED]: [],
};

function assertTransition(from: string, to: string) {
  if (!to || from === to) return;
  if (!(TRANSITIONS[from] ?? []).includes(to)) {
    throw new Error(`ไม่สามารถเปลี่ยนสถานะคำขอบริการจาก "${from}" เป็น "${to}" ได้`);
  }
}

async function hasPerm(c: Context<AppEnv>, permissionKey: string): Promise<boolean> {
  const { data, error } = await c.get('supabase').rpc('has_permission', { permission_key_input: permissionKey });
  return !error && data === true;
}

interface EligibilityRule {
  roles?: string[];
  departmentIds?: string[];
}

async function resolveActorEligibilityContext(c: Context<AppEnv>) {
  const supabase = c.get('supabase');
  const actorId = c.get('userId');
  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    supabase.from('profiles').select('department_id').eq('id', actorId).maybeSingle(),
    supabase.from('user_roles').select('roles(key)').eq('user_id', actorId),
  ]);
  const roleKeys = (roleRows ?? [])
    .map((row) => (row as unknown as { roles: { key: string } | null }).roles?.key)
    .filter((key): key is string => Boolean(key));
  return { departmentId: (profile as { department_id: string | null } | null)?.department_id ?? null, roleKeys };
}

function isEligible(eligibility: EligibilityRule | null, ctx: { departmentId: string | null; roleKeys: string[] }): boolean {
  if (!eligibility) return true;
  const roles = eligibility.roles ?? [];
  const departmentIds = eligibility.departmentIds ?? [];
  if (roles.length && ctx.roleKeys.some((key) => roles.includes(key))) return true;
  if (departmentIds.length && ctx.departmentId && departmentIds.includes(ctx.departmentId)) return true;
  return false;
}

async function activeApprovalGroupIdsFor(c: Context<AppEnv>): Promise<string[]> {
  const supabase = c.get('supabase');
  const actorId = c.get('userId');
  const { data } = await supabase.from('approval_group_members').select('group_id').eq('user_id', actorId).eq('status', 'active');
  return (data ?? []).map((row) => row.group_id as string);
}

serviceRequestsRoute.get('/', zValidator('query', listServiceRequestsQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const { page, pageSize, status, assigneeId, mine, pendingMyApproval } = c.req.valid('query');

  // RLS (service_requests_select_participant_or_staff) เป็นตัวกรองสิทธิ์การมองเห็นจริง
  let query = supabase
    .from('service_requests')
    .select('id, service_code, service_name, requester_id, priority, status, approval_status, assignee_id, due_at, created_at', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(...paginationRange(page, pageSize));

  if (status) query = query.eq('status', status);
  if (assigneeId) query = query.eq('assignee_id', assigneeId);
  if (mine === 'true') query = query.eq('requester_id', actorId);
  if (pendingMyApproval === 'true') {
    const groupIds = await activeApprovalGroupIdsFor(c);
    if (!groupIds.length) {
      return c.json(ok(reqId, toPaginatedData([], 0, page, pageSize)));
    }
    query = query.eq('status', STATUS.PENDING_APPROVAL).in('approval_group_id', groupIds);
  }

  const { data, count, error } = await query;
  if (error) {
    return c.json(fail(reqId, 'SERVICE_REQUESTS_LIST_FAILED', 'ดึงรายการคำขอบริการไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, toPaginatedData(data, count, page, pageSize)));
});

/**
 * รายชื่อเจ้าหน้าที่ที่มอบหมายได้ — ต้องอยู่ก่อน '/:id' เหมือน routes/tickets.ts (Module 4) ไม่งั้น
 * Hono จะจับคำว่า "assignable-staff" เป็นค่า :id แทน
 */
serviceRequestsRoute.get('/assignable-staff', async (c) => {
  const reqId = c.get('requestId');
  const [canUpdate, canAssign] = await Promise.all([hasPerm(c, 'service_request.update'), hasPerm(c, 'service_request.assign')]);
  if (!canUpdate && !canAssign) {
    return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์ดำเนินการนี้'), 403);
  }
  const admin = createAdminClient(c.env);
  const { data, error } = await admin.from('profiles').select('id, full_name, email').eq('status', 'active').order('full_name');
  if (error) {
    return c.json(fail(reqId, 'ASSIGNABLE_STAFF_LOAD_FAILED', 'ดึงรายชื่อเจ้าหน้าที่ไม่สำเร็จ'), 400);
  }
  return c.json(ok(reqId, data));
});

serviceRequestsRoute.get('/:id', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id');

  const { data: request, error } = await supabase
    .from('service_requests')
    .select(
      '*, service_catalog(service_name, category), requester:profiles!service_requests_requester_id_fkey(full_name, email), assignee:profiles!service_requests_assignee_id_fkey(full_name, email), approval_group:approval_groups(code, name)',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return c.json(fail(reqId, 'SERVICE_REQUEST_LOAD_FAILED', 'ดึงข้อมูลคำขอบริการไม่สำเร็จ'), 400);
  }
  if (!request) {
    return c.json(fail(reqId, 'SERVICE_REQUEST_NOT_FOUND', 'ไม่พบคำขอบริการนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const [{ data: tasks, error: tasksError }, { data: history, error: historyError }] = await Promise.all([
    supabase.from('service_request_tasks').select('*').eq('request_id', id).order('sequence', { ascending: true }),
    supabase
      .from('service_request_history')
      .select('*, actor:profiles!service_request_history_actor_id_fkey(full_name, email)')
      .eq('request_id', id)
      .order('created_at', { ascending: true }),
  ]);

  if (tasksError || historyError) {
    return c.json(fail(reqId, 'SERVICE_REQUEST_CHILDREN_LOAD_FAILED', 'ดึงรายละเอียดคำขอบริการไม่สำเร็จ'), 400);
  }

  return c.json(ok(reqId, { ...request, tasks: tasks ?? [], history: history ?? [] }));
});

serviceRequestsRoute.post(
  '/',
  requirePermission('service_request.create'),
  zValidator('json', submitServiceRequestSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const body = c.req.valid('json');

    if (body.idempotencyKey) {
      const { data: existing } = await supabase
        .from('service_requests')
        .select('*')
        .eq('requester_id', actorId)
        .eq('idempotency_key', body.idempotencyKey)
        .maybeSingle();
      if (existing) return c.json(ok(reqId, existing), 200);
    }

    const { data: catalog, error: catalogError } = await supabase
      .from('service_catalog')
      .select('*')
      .eq('id', body.catalogId)
      .eq('status', 'active')
      .maybeSingle();
    if (catalogError || !catalog) {
      return c.json(fail(reqId, 'SERVICE_CATALOG_INVALID', 'กรุณาเลือกบริการที่เปิดใช้งานอยู่'), 400);
    }

    const eligibilityCtx = await resolveActorEligibilityContext(c);
    if (!isEligible(catalog.eligibility, eligibilityCtx)) {
      return c.json(fail(reqId, 'SERVICE_REQUEST_NOT_ELIGIBLE', 'ท่านไม่มีสิทธิ์ขอบริการรายการนี้'), 403);
    }

    const approvalRequired = catalog.approval_mode === 'group';
    const initialStatus = approvalRequired ? STATUS.PENDING_APPROVAL : STATUS.PENDING_ASSIGNMENT;
    const slaHours = Number(catalog.sla_hours ?? 24);
    const now = new Date();
    const dueAt = new Date(now.getTime() + slaHours * 3600 * 1000);

    const { data: request, error } = await supabase
      .from('service_requests')
      .insert({
        catalog_id: catalog.id,
        catalog_version: catalog.version,
        service_code: catalog.service_code,
        service_name: catalog.service_name,
        requester_id: actorId,
        requested_for: body.requestedFor ?? null,
        summary: body.summary ?? catalog.service_name,
        request_details: body.answers ?? {},
        business_justification: body.businessJustification ?? null,
        priority: body.priority ?? 'ปานกลาง',
        impact: body.impact ?? 'ปานกลาง',
        sla_hours: slaHours,
        due_at: dueAt.toISOString(),
        approval_mode: catalog.approval_mode,
        approval_group_id: approvalRequired ? catalog.approval_group_id : null,
        approval_status: approvalRequired ? 'pending' : 'not_required',
        assigned_group_id: catalog.fulfillment_group_id,
        close_mode: catalog.close_mode,
        status: initialStatus,
        checklist_snapshot: catalog.checklist,
        idempotency_key: body.idempotencyKey ?? null,
        created_by: actorId,
      })
      .select()
      .single();

    if (error) {
      return dbFailJson(c, 'SERVICE_REQUEST_CREATE_FAILED', error);
    }

    // ผู้ยื่นคำขอมีแค่ service_request.create ไม่มี service_request.update ซึ่ง RLS insert policy
    // ของ service_request_tasks/service_request_history ต้องการ — ใช้ Admin client เขียนชุดข้อมูล
    // ที่ระบบสร้างอัตโนมัติหลังยื่นคำขอสำเร็จ (บทเรียนเดียวกับ ticket_worklogs ใน Module 4)
    const admin = createAdminClient(c.env);
    const checklist = Array.isArray(catalog.checklist) ? (catalog.checklist as Array<Record<string, unknown>>) : [];
    if (checklist.length) {
      await admin.from('service_request_tasks').insert(
        checklist.map((item, index) => ({
          request_id: request.id,
          sequence: index + 1,
          task_name: String(item.name ?? `งานที่ ${index + 1}`),
          task_type: item.taskType ?? null,
          owner_group_id: item.ownerGroupId ?? catalog.fulfillment_group_id,
          is_required: item.isRequired ?? true,
          created_by: actorId,
        })),
      );
    }
    await admin.from('service_request_history').insert({
      request_id: request.id,
      action: 'ยื่นคำขอ',
      status_to: initialStatus,
      comment: 'ยื่นคำขอผ่านระบบ',
      is_public: true,
      actor_id: actorId,
    });

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'CREATE',
      module: 'service_request',
      targetTable: 'service_requests',
      targetId: request.id,
      detail: { catalogId: body.catalogId, serviceCode: catalog.service_code },
      requestId: reqId,
    });

    if (approvalRequired && catalog.approval_group_id) {
      const { data: members } = await admin
        .from('approval_group_members')
        .select('user_id')
        .eq('group_id', catalog.approval_group_id)
        .eq('status', 'active');
      for (const member of members ?? []) {
        if (member.user_id === actorId) continue;
        await sendNotification(c.env, {
          recipientId: member.user_id,
          type: 'service_request_approval_needed',
          title: `มีคำขอบริการรออนุมัติ: ${request.service_name}`,
          link: `/service-requests/${request.id}`,
        });
      }
    }

    return c.json(ok(reqId, request), 201);
  },
);

serviceRequestsRoute.post(
  '/:id/approve',
  zValidator('json', approveServiceRequestSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const { data: current, error: currentError } = await supabase.from('service_requests').select('*').eq('id', id).maybeSingle();
    if (currentError || !current) {
      return c.json(fail(reqId, 'SERVICE_REQUEST_NOT_FOUND', 'ไม่พบคำขอบริการนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
    }
    if (current.status !== STATUS.PENDING_APPROVAL || current.approval_status !== 'pending') {
      return c.json(fail(reqId, 'SERVICE_REQUEST_NOT_PENDING_APPROVAL', 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ'), 400);
    }
    if (current.requester_id === actorId) {
      return c.json(fail(reqId, 'PERMISSION_DENIED', 'ผู้ยื่นคำขอไม่สามารถอนุมัติคำขอของตนเองได้'), 403);
    }

    let authorized = await hasPerm(c, 'service_request.approve');
    if (!authorized && current.approval_group_id) {
      const { data: membership } = await supabase
        .from('approval_group_members')
        .select('id')
        .eq('group_id', current.approval_group_id)
        .eq('user_id', actorId)
        .eq('status', 'active')
        .maybeSingle();
      authorized = Boolean(membership);
    }
    if (!authorized) {
      return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่ใช่สมาชิกกลุ่มอนุมัติที่กำหนดสำหรับคำขอนี้'), 403);
    }
    if (!body.approved && !body.comment) {
      return c.json(fail(reqId, 'VALIDATION_ERROR', 'กรุณาระบุเหตุผลการปฏิเสธ', [{ field: 'comment', message: 'จำเป็น' }]), 400);
    }

    const newStatus = body.approved ? STATUS.PENDING_ASSIGNMENT : STATUS.REJECTED;
    try {
      assertTransition(current.status, newStatus);
    } catch (e) {
      return c.json(fail(reqId, 'SERVICE_REQUEST_TRANSITION_INVALID', (e as Error).message), 400);
    }

    const patch: Record<string, unknown> = {
      approval_status: body.approved ? 'approved' : 'rejected',
      approved_by: actorId,
      approved_at: new Date().toISOString(),
      status: newStatus,
      updated_by: actorId,
    };
    if (!body.approved) patch.closed_at = new Date().toISOString();

    const { data: updated, error } = await supabase.from('service_requests').update(patch).eq('id', id).select().single();
    if (error) {
      return dbFailJson(c, 'SERVICE_REQUEST_APPROVAL_FAILED', error);
    }

    await supabase.from('service_request_history').insert({
      request_id: id,
      action: body.approved ? 'อนุมัติคำขอ' : 'ปฏิเสธคำขอ',
      status_from: current.status,
      status_to: newStatus,
      comment: body.comment ?? null,
      is_public: true,
      actor_id: actorId,
    });

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: body.approved ? 'APPROVE' : 'REJECT',
      module: 'service_request',
      targetTable: 'service_requests',
      targetId: id,
      detail: body,
      requestId: reqId,
    });

    await sendNotification(c.env, {
      recipientId: current.requester_id,
      type: body.approved ? 'service_request_approved' : 'service_request_rejected',
      title: `คำขอบริการ "${updated.service_name}" ${body.approved ? 'ได้รับการอนุมัติ' : 'ถูกปฏิเสธ'}`,
      link: `/service-requests/${id}`,
    });

    return c.json(ok(reqId, updated));
  },
);

serviceRequestsRoute.patch('/:id', zValidator('json', updateServiceRequestSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const { data: current, error: currentError } = await supabase.from('service_requests').select('*').eq('id', id).maybeSingle();
  if (currentError || !current) {
    return c.json(fail(reqId, 'SERVICE_REQUEST_NOT_FOUND', 'ไม่พบคำขอบริการนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const isRequesterSelf = current.requester_id === actorId;
  const [canUpdate, canAssign, canClose] = await Promise.all([
    hasPerm(c, 'service_request.update'),
    hasPerm(c, 'service_request.assign'),
    hasPerm(c, 'service_request.close'),
  ]);

  const fromStatus = String(current.status);
  const toStatus = body.status ?? fromStatus;
  const isConfirmPath =
    isRequesterSelf &&
    fromStatus === STATUS.PENDING_CONFIRMATION &&
    (toStatus === STATUS.CLOSED || toStatus === STATUS.IN_PROGRESS);
  const isCancel = toStatus === STATUS.CANCELLED && toStatus !== fromStatus;
  const isFinalizing = FINALIZING_STATUSES.includes(toStatus) && toStatus !== fromStatus && !isConfirmPath;

  let requesterAuthoredHistory = false;

  if (isConfirmPath) {
    if (toStatus === STATUS.IN_PROGRESS && !body.note) {
      return c.json(fail(reqId, 'VALIDATION_ERROR', 'กรุณาระบุสิ่งที่ต้องแก้ไขเพิ่มเติม', [{ field: 'note', message: 'จำเป็น' }]), 400);
    }
    requesterAuthoredHistory = true;
  } else if (isCancel) {
    if (!isRequesterSelf && !canUpdate && !canClose && !canAssign) {
      return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์ยกเลิกคำขอนี้'), 403);
    }
    if (!body.cancelReason && !body.note) {
      return c.json(
        fail(reqId, 'VALIDATION_ERROR', 'กรุณาระบุเหตุผลการยกเลิก', [{ field: 'cancelReason', message: 'จำเป็น' }]),
        400,
      );
    }
    try {
      assertTransition(fromStatus, toStatus);
    } catch (e) {
      return c.json(fail(reqId, 'SERVICE_REQUEST_TRANSITION_INVALID', (e as Error).message), 400);
    }
    requesterAuthoredHistory = isRequesterSelf && !canUpdate && !canClose && !canAssign;
  } else if (isFinalizing) {
    if (!canClose) return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์ปิดงานคำขอนี้'), 403);
    try {
      assertTransition(fromStatus, toStatus);
    } catch (e) {
      return c.json(fail(reqId, 'SERVICE_REQUEST_TRANSITION_INVALID', (e as Error).message), 400);
    }
    const note = body.fulfillmentNotes ?? body.note;
    if (!note && !current.fulfillment_notes) {
      return c.json(
        fail(reqId, 'VALIDATION_ERROR', 'กรุณาระบุผลการดำเนินการก่อนส่งมอบ/ปิดงาน', [{ field: 'fulfillmentNotes', message: 'จำเป็น' }]),
        400,
      );
    }
    const expectedTarget = current.close_mode === 'it_closes' ? STATUS.CLOSED : STATUS.PENDING_CONFIRMATION;
    if (toStatus !== expectedTarget) {
      return c.json(
        fail(
          reqId,
          'SERVICE_REQUEST_CLOSE_MODE_MISMATCH',
          current.close_mode === 'it_closes' ? 'บริการนี้กำหนดให้ IT ปิดงานโดยตรง' : 'บริการนี้กำหนดให้ผู้ขอยืนยันผลก่อนปิดงาน',
        ),
        400,
      );
    }
    const { count: incompleteRequired } = await supabase
      .from('service_request_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('request_id', id)
      .eq('is_required', true)
      .neq('status', 'เสร็จสิ้น');
    if ((incompleteRequired ?? 0) > 0) {
      return c.json(fail(reqId, 'SERVICE_REQUEST_TASKS_INCOMPLETE', 'มีงาน Checklist ที่บังคับยังไม่เสร็จสิ้น'), 400);
    }
  } else if (toStatus !== fromStatus) {
    if (!canUpdate && !canAssign) return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์ดำเนินการนี้'), 403);
    try {
      assertTransition(fromStatus, toStatus);
    } catch (e) {
      return c.json(fail(reqId, 'SERVICE_REQUEST_TRANSITION_INVALID', (e as Error).message), 400);
    }
  } else if (!canUpdate) {
    const onlyAssigneeChange = Object.keys(body).every((k) => k === 'assigneeId' || k === 'assignedGroupId' || k === 'note');
    if (!onlyAssigneeChange || !canAssign) {
      return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์ดำเนินการนี้'), 403);
    }
  }

  if (body.assigneeId !== undefined && !canAssign && !canUpdate) {
    return c.json(fail(reqId, 'PERMISSION_DENIED', 'ท่านไม่มีสิทธิ์มอบหมายผู้รับผิดชอบ'), 403);
  }

  const patch: Record<string, unknown> = { updated_by: actorId };
  const now = new Date();
  if (body.assigneeId !== undefined) patch.assignee_id = body.assigneeId;
  if (body.assignedGroupId !== undefined) patch.assigned_group_id = body.assignedGroupId;
  if (body.priority !== undefined) patch.priority = body.priority;
  if (body.fulfillmentNotes !== undefined) patch.fulfillment_notes = body.fulfillmentNotes;
  if (body.completionEvidence !== undefined) patch.completion_evidence = body.completionEvidence;

  if (isConfirmPath) {
    patch.status = toStatus;
    patch.requester_confirmed_at = now.toISOString();
    patch.requester_confirmation = toStatus === STATUS.CLOSED;
    if (toStatus === STATUS.CLOSED) {
      patch.closed_at = now.toISOString();
      patch.completed_at = current.completed_at ?? now.toISOString();
    }
  } else if (isCancel) {
    patch.status = STATUS.CANCELLED;
    patch.closed_at = now.toISOString();
    patch.cancel_reason = body.cancelReason ?? body.note;
  } else if (isFinalizing) {
    patch.status = toStatus;
    patch.fulfillment_notes = body.fulfillmentNotes ?? body.note ?? current.fulfillment_notes;
    patch.completed_at = current.completed_at ?? now.toISOString();
    if (toStatus === STATUS.CLOSED) patch.closed_at = now.toISOString();
  } else if (toStatus !== fromStatus) {
    patch.status = toStatus;
  }

  const auditBefore = await loadAuditSnapshot(supabase, 'service_requests', id);
  const { data: updated, error } = await supabase.from('service_requests').update(patch).eq('id', id).select().single();
  if (error) {
    return dbFailJson(c, 'SERVICE_REQUEST_UPDATE_FAILED', error);
  }

  const historyAction = isConfirmPath
    ? toStatus === STATUS.CLOSED
      ? 'ยืนยันผลและปิดงาน'
      : 'ส่งกลับแก้ไข'
    : isCancel
      ? 'ยกเลิกคำขอ'
      : isFinalizing
        ? toStatus === STATUS.PENDING_CONFIRMATION
          ? 'ส่งรอผู้ขอยืนยันผล'
          : 'ปิดงาน'
        : fromStatus === STATUS.PENDING_ASSIGNMENT && toStatus === STATUS.IN_PROGRESS
          ? 'มอบหมายงาน'
          : toStatus !== fromStatus
            ? 'อัปเดตสถานะ'
            : body.assigneeId !== undefined
              ? 'เปลี่ยนผู้รับผิดชอบ'
              : 'บันทึกการดำเนินงาน';

  // Action ที่ requester เป็นผู้ทำเอง (ยืนยัน/ส่งกลับแก้ไข/ยกเลิกด้วยตนเอง) ไม่มีสิทธิ์ staff ใดๆ ที่
  // RLS insert policy ของ service_request_history ต้องการ — ใช้ Admin client เหมือนตอนยื่นคำขอ
  const historyClient = requesterAuthoredHistory ? createAdminClient(c.env) : supabase;
  await historyClient.from('service_request_history').insert({
    request_id: id,
    action: historyAction,
    comment: body.note ?? null,
    status_from: fromStatus,
    status_to: (patch.status as string) ?? fromStatus,
    is_public: true,
    actor_id: actorId,
  });

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE',
    module: 'service_request',
    targetTable: 'service_requests',
    targetId: id,
    detail: body,
    requestId: reqId,
      before: auditBefore,
    after: updated,
});

  if (body.assigneeId && body.assigneeId !== current.assignee_id) {
    await sendNotification(c.env, {
      recipientId: body.assigneeId,
      type: 'service_request_assigned',
      title: `ท่านได้รับมอบหมายคำขอบริการ: ${updated.service_name}`,
      link: `/service-requests/${id}`,
    });
  }
  if (patch.status && patch.status !== fromStatus && current.requester_id !== actorId) {
    await sendNotification(c.env, {
      recipientId: current.requester_id,
      type: 'service_request_status_changed',
      title: `คำขอบริการ "${updated.service_name}" เปลี่ยนสถานะเป็น ${patch.status}`,
      link: `/service-requests/${id}`,
    });
  }

  return c.json(ok(reqId, updated));
});

serviceRequestsRoute.patch(
  '/:id/tasks/:taskId',
  requirePermission('service_request.update'),
  zValidator('json', updateServiceRequestTaskSchema, zodValidationHook),
  async (c) => {
    const supabase = c.get('supabase');
    const reqId = c.get('requestId');
    const actorId = c.get('userId');
    const id = c.req.param('id');
    const taskId = c.req.param('taskId');
    const body = c.req.valid('json');

    const { data: task, error: taskError } = await supabase
      .from('service_request_tasks')
      .select('*')
      .eq('id', taskId)
      .eq('request_id', id)
      .maybeSingle();
    if (taskError || !task) {
      return c.json(fail(reqId, 'SERVICE_REQUEST_TASK_NOT_FOUND', 'ไม่พบงาน Checklist นี้'), 404);
    }
    const { data: request, error: requestError } = await supabase.from('service_requests').select('status').eq('id', id).maybeSingle();
    if (requestError || !request) {
      return c.json(fail(reqId, 'SERVICE_REQUEST_NOT_FOUND', 'ไม่พบคำขอบริการนี้'), 404);
    }
    const blockedStatuses: string[] = [STATUS.PENDING_APPROVAL, STATUS.PENDING_CONFIRMATION, STATUS.CLOSED, STATUS.REJECTED, STATUS.CANCELLED];
    if (blockedStatuses.includes(request.status)) {
      return c.json(fail(reqId, 'SERVICE_REQUEST_NOT_EDITABLE', 'คำขอนี้ไม่อยู่ในสถานะที่แก้ไข Checklist ได้'), 400);
    }
    if (body.status === 'ข้าม' && task.is_required) {
      return c.json(fail(reqId, 'SERVICE_REQUEST_TASK_REQUIRED', 'Checklist ที่บังคับไม่สามารถข้ามได้'), 400);
    }

    const patch: Record<string, unknown> = {
      status: body.status,
      updated_by: actorId,
    };
    if (body.assigneeId !== undefined) patch.assignee_id = body.assigneeId;
    if (body.evidenceLink !== undefined) patch.evidence_link = body.evidenceLink;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.status === 'เสร็จสิ้น') {
      patch.completed_at = new Date().toISOString();
      patch.completed_by = actorId;
    } else {
      patch.completed_at = null;
      patch.completed_by = null;
    }

    const { data: updated, error } = await supabase.from('service_request_tasks').update(patch).eq('id', taskId).select().single();
    if (error) {
      return dbFailJson(c, 'SERVICE_REQUEST_TASK_UPDATE_FAILED', error);
    }

    await supabase.from('service_request_history').insert({
      request_id: id,
      action: 'อัปเดต Checklist',
      comment: `${task.task_name}: ${body.status}${body.notes ? ' - ' + body.notes : ''}`,
      is_public: false,
      actor_id: actorId,
    });

    await writeAuditLog(c.env, {
      actorId,
      actorEmail: c.get('userEmail'),
      action: 'UPDATE_TASK',
      module: 'service_request',
      targetTable: 'service_request_tasks',
      targetId: taskId,
      detail: body,
      requestId: reqId,
    });

    return c.json(ok(reqId, updated));
  },
);
