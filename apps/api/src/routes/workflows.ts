import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { createAdminClient } from '../lib/supabase';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import { sendNotification } from '../services/notificationService';
import { requiredWorkflowApprovals, workflowDecisionStatus } from '../services/workflowEngine';
import type { AppEnv, Bindings } from '../types';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  cancelWorkflowSchema, createWorkflowDefinitionSchema, createWorkflowDelegationSchema,
  revokeWorkflowDelegationSchema, startWorkflowSchema, updateWorkflowDefinitionSchema,
  workflowDecisionSchema,
} from '../validators/workflows';

export const workflowsRoute = new Hono<AppEnv>();
workflowsRoute.use('*', requireAuth);

type AdminClient = ReturnType<typeof createAdminClient>;
interface WorkflowStepInput {
  stepCode: string; stepName: string; approvalType: 'USER' | 'ROLE' | 'GROUP'; approverValue: string;
  mode: 'ANY' | 'ALL' | 'QUORUM'; minApprovals: number; slaHours: number;
  allowDelegation: boolean; allowReturn: boolean;
}
interface WorkflowStepRow {
  id: string; definition_id: string; definition_version: number; step_order: number;
  step_code: string; step_name: string; approval_type: 'USER' | 'ROLE' | 'GROUP';
  approver_value: string; mode: 'ANY' | 'ALL' | 'QUORUM'; min_approvals: number;
  sla_hours: number; allow_delegation: boolean; allow_return: boolean;
}
interface WorkflowInstanceRow {
  id: string; instance_code: string; definition_id: string; definition_version: number;
  module_key: string; record_label: string; requester_id: string;
}
interface HistoryValues {
  approval_id?: string; step_order?: number; status_from?: string; status_to?: string;
  comment?: string; detail?: Record<string, unknown>; is_public?: boolean;
}

function code(prefix: string): string {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `${prefix}-${stamp}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function addHours(hours: number): string { return new Date(Date.now() + hours * 3_600_000).toISOString(); }

async function hasPermission(c: Context<AppEnv>, key: string): Promise<boolean> {
  const { data, error } = await c.get('supabase').rpc('has_permission', { permission_key_input: key });
  return !error && data === true;
}

async function history(admin: AdminClient, instanceId: string, action: string, actorId: string | null, values: HistoryValues = {}) {
  const { error } = await admin.from('workflow_history').insert({
    instance_id: instanceId, approval_id: values.approval_id ?? null, action,
    step_order: values.step_order ?? null, status_from: values.status_from ?? null,
    status_to: values.status_to ?? null, actor_id: actorId, comment: values.comment ?? null,
    detail: values.detail ?? {}, is_public: values.is_public ?? true,
  });
  if (error) throw new Error(error.message);
}

async function validateSteps(admin: AdminClient, steps: WorkflowStepInput[]): Promise<string | null> {
  for (const step of steps) {
    if (step.approvalType === 'USER') {
      const { data } = await admin.from('profiles').select('id').eq('id', step.approverValue).eq('status', 'active').maybeSingle();
      if (!data) return `ไม่พบผู้อนุมัติที่ใช้งานอยู่ในขั้น ${step.stepName}`;
    } else if (step.approvalType === 'ROLE') {
      const { data } = await admin.from('roles').select('id').eq('key', step.approverValue).eq('status', 'active').maybeSingle();
      if (!data) return `ไม่พบบทบาทผู้อนุมัติในขั้น ${step.stepName}`;
    } else {
      const { data } = await admin.from('approval_groups').select('id').eq('id', step.approverValue).eq('status', 'active').maybeSingle();
      if (!data) return `ไม่พบกลุ่มอนุมัติในขั้น ${step.stepName}`;
    }
  }
  return null;
}

function stepRows(definitionId: string, version: number, steps: WorkflowStepInput[], actorId: string) {
  return steps.map((step, index) => ({
    definition_id: definitionId, definition_version: version, step_order: index + 1,
    step_code: step.stepCode, step_name: step.stepName, approval_type: step.approvalType,
    approver_value: step.approverValue, mode: step.mode, min_approvals: step.minApprovals,
    sla_hours: step.slaHours, allow_delegation: step.allowDelegation,
    allow_return: step.allowReturn, status: 'ใช้งาน', created_by: actorId, updated_by: actorId,
  }));
}

async function resolveActors(admin: AdminClient, step: WorkflowStepRow): Promise<string[]> {
  if (step.approval_type === 'USER') return [step.approver_value];
  if (step.approval_type === 'ROLE') {
    const { data, error } = await admin.from('user_roles').select('user_id, roles!inner(key), profiles!inner(status)').eq('roles.key', step.approver_value).eq('profiles.status', 'active');
    if (error) throw new Error(error.message);
    return [...new Set((data ?? []).map((row) => row.user_id))];
  }
  const now = new Date().toISOString();
  const { data, error } = await admin.from('approval_group_members').select('user_id, profiles!inner(status)').eq('group_id', step.approver_value).eq('status', 'active').eq('profiles.status', 'active').or(`valid_from.is.null,valid_from.lte.${now}`).or(`valid_until.is.null,valid_until.gte.${now}`);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((row) => row.user_id))];
}

async function delegatedActor(admin: AdminClient, originalId: string, instance: WorkflowInstanceRow, step: WorkflowStepRow): Promise<string> {
  if (!step.allow_delegation) return originalId;
  const now = new Date().toISOString();
  const { data } = await admin.from('workflow_delegations').select('*').eq('delegator_id', originalId).eq('status', 'Active').lte('start_at', now).gte('end_at', now).order('created_at', { ascending: false });
  const match = (data ?? []).find((item) => (!item.module_key || item.module_key === instance.module_key) && (!item.definition_id || item.definition_id === instance.definition_id));
  return match?.delegate_id ?? originalId;
}

async function activateStep(admin: AdminClient, env: Bindings, instance: WorkflowInstanceRow, step: WorkflowStepRow, actorId: string | null) {
  const originals = (await resolveActors(admin, step)).filter((id) => id !== instance.requester_id);
  if (!originals.length) throw new Error(`ขั้น ${step.step_name} ไม่มีผู้อนุมัติที่ใช้งานอยู่ หรือขัดหลัก Separation of Duties`);
  if (step.mode === 'QUORUM' && step.min_approvals > originals.length) throw new Error(`ขั้น ${step.step_name} กำหนด Quorum มากกว่าจำนวนผู้อนุมัติ`);
  const approvals = await Promise.all(originals.map(async (originalId) => ({
    instance_id: instance.id, step_id: step.id, step_order: step.step_order,
    original_approver_id: originalId, approver_id: await delegatedActor(admin, originalId, instance, step),
    status: 'รอพิจารณา', due_at: addHours(step.sla_hours), created_by: actorId, updated_by: actorId,
  })));
  const { data, error } = await admin.from('workflow_approvals').insert(approvals).select('id,approver_id');
  if (error) throw new Error(error.message);
  const { error: updateError } = await admin.from('workflow_instances').update({ current_step_order: step.step_order, updated_by: actorId }).eq('id', instance.id);
  if (updateError) throw new Error(updateError.message);
  await history(admin, instance.id, 'STEP_ACTIVATED', actorId, { step_order: step.step_order, status_to: 'รอพิจารณา', detail: { stepCode: step.step_code, mode: step.mode, actorCount: approvals.length } });
  await Promise.all((data ?? []).map((approval) => sendNotification(env, { recipientId: approval.approver_id, type: 'workflow_approval', title: `รออนุมัติ: ${instance.record_label}`, body: `${step.step_name} · ${instance.instance_code}`, link: '/workflows' })));
}

workflowsRoute.get('/', requirePermission('workflow.view'), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const admin = createAdminClient(c.env);
  const [canManage, canApprove, canDelegate, canViewAll] = await Promise.all(['workflow.manage', 'workflow.approve', 'workflow.delegate', 'workflow.view_all'].map((key) => hasPermission(c, key)));
  const [definitions, steps, instances, approvals, histories, delegations, profiles] = await Promise.all([
    admin.from('workflow_definitions').select('*').order('workflow_code'),
    admin.from('workflow_steps').select('*').eq('status', 'ใช้งาน').order('step_order'),
    admin.from('workflow_instances').select('*').order('started_at', { ascending: false }).limit(500),
    admin.from('workflow_approvals').select('*').order('created_at').limit(2000),
    admin.from('workflow_history').select('*').order('action_at').limit(3000),
    admin.from('workflow_delegations').select('*').order('start_at', { ascending: false }).limit(500),
    admin.from('profiles').select('id,full_name,email'),
  ]);
  const error = definitions.error ?? steps.error ?? instances.error ?? approvals.error ?? histories.error ?? delegations.error ?? profiles.error;
  if (error) return c.json(fail(reqId, 'WORKFLOW_LOAD_FAILED', error.message), 400);
  const profileById = new Map((profiles.data ?? []).map((item) => [item.id, item]));
  const approvalRows = approvals.data ?? [];
  const visibleInstances = (instances.data ?? []).filter((instance) => canViewAll || canManage || instance.requester_id === actorId || approvalRows.some((approval) => approval.instance_id === instance.id && (approval.approver_id === actorId || approval.original_approver_id === actorId)));
  const visibleIds = new Set(visibleInstances.map((item) => item.id));
  const definitionById = new Map((definitions.data ?? []).map((item) => [item.id, item]));
  const shapedInstances = visibleInstances.map((instance) => ({
    ...instance, requester: profileById.get(instance.requester_id) ?? null,
    definition: definitionById.has(instance.definition_id) ? (({ id, workflow_code, workflow_name }) => ({ id, workflow_code, workflow_name }))(definitionById.get(instance.definition_id)) : null,
    approvals: approvalRows.filter((approval) => approval.instance_id === instance.id).map((approval) => ({ ...approval, approver: profileById.get(approval.approver_id) ?? null, original_approver: profileById.get(approval.original_approver_id) ?? null, can_act: canApprove && approval.approver_id === actorId && approval.status === 'รอพิจารณา' })),
    history: (histories.data ?? []).filter((item) => item.instance_id === instance.id).map((item) => ({ ...item, actor: item.actor_id ? profileById.get(item.actor_id) ?? null : null })),
  }));
  const myApprovals = approvalRows.filter((approval) => visibleIds.has(approval.instance_id) && approval.approver_id === actorId && approval.status === 'รอพิจารณา').map((approval) => ({ ...approval, approver: profileById.get(approval.approver_id) ?? null, original_approver: profileById.get(approval.original_approver_id) ?? null, can_act: canApprove }));
  const now = Date.now();
  const visibleDefinitions = (definitions.data ?? []).filter((item) => canManage || item.status === 'ใช้งาน').map((definition) => ({ ...definition, steps: (steps.data ?? []).filter((step) => step.definition_id === definition.id && step.definition_version === definition.version) }));
  const visibleDelegations = (delegations.data ?? []).filter((item) => canManage || item.delegator_id === actorId || item.delegate_id === actorId).map((item) => ({ ...item, status: item.status === 'Active' && new Date(item.end_at).getTime() < now ? 'Expired' : item.status, delegator: profileById.get(item.delegator_id) ?? null, delegate: profileById.get(item.delegate_id) ?? null, definition: item.definition_id && definitionById.has(item.definition_id) ? (({ id, workflow_code, workflow_name }) => ({ id, workflow_code, workflow_name }))(definitionById.get(item.definition_id)) : null }));
  return c.json(ok(reqId, {
    summary: { pendingMine: myApprovals.length, overdueMine: myApprovals.filter((item) => item.due_at && new Date(item.due_at).getTime() < now).length, activeMine: visibleInstances.filter((item) => item.requester_id === actorId && item.status === 'กำลังดำเนินการ').length, activeVisible: visibleInstances.filter((item) => item.status === 'กำลังดำเนินการ').length },
    capabilities: { canManage, canApprove, canDelegate, canViewAll }, myApprovals, instances: shapedInstances, definitions: visibleDefinitions, delegations: visibleDelegations,
  }));
});

workflowsRoute.get('/options', requirePermission('workflow.view'), async (c) => {
  const reqId = c.get('requestId'); const admin = createAdminClient(c.env);
  const [users, roles, groups] = await Promise.all([
    admin.from('profiles').select('id,full_name,email').eq('status', 'active').order('full_name'),
    admin.from('roles').select('id,key,name_th').eq('status', 'active').order('name_th'),
    admin.from('approval_groups').select('id,code,name').eq('status', 'active').order('code'),
  ]);
  const error = users.error ?? roles.error ?? groups.error;
  if (error) return c.json(fail(reqId, 'WORKFLOW_OPTIONS_FAILED', error.message), 400);
  return c.json(ok(reqId, { users: users.data ?? [], roles: roles.data ?? [], groups: groups.data ?? [] }));
});

workflowsRoute.post('/definitions', requirePermission('workflow.manage'), zValidator('json', createWorkflowDefinitionSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const body = c.req.valid('json'); const admin = createAdminClient(c.env);
  const invalid = await validateSteps(admin, body.steps); if (invalid) return c.json(fail(reqId, 'WORKFLOW_STEP_REFERENCE_INVALID', invalid), 400);
  const { data: existing } = await admin.from('workflow_definitions').select('id').eq('workflow_code', body.workflowCode).maybeSingle();
  if (existing) return c.json(fail(reqId, 'WORKFLOW_CODE_EXISTS', 'รหัส Workflow นี้มีอยู่แล้ว'), 409);
  const { data, error } = await admin.from('workflow_definitions').insert({ workflow_code: body.workflowCode, workflow_name: body.workflowName, module_key: body.moduleKey, description: body.description ?? null, version: 1, trigger_event: body.triggerEvent ?? 'MANUAL', sla_hours: body.slaHours, is_default: false, status: body.status, active_from: body.activeFrom ?? null, active_to: body.activeTo ?? null, notes: body.notes ?? null, created_by: actorId, updated_by: actorId }).select('*').single();
  if (error) return c.json(fail(reqId, 'WORKFLOW_DEFINITION_CREATE_FAILED', error.message), 400);
  const { error: stepError } = await admin.from('workflow_steps').insert(stepRows(data.id, 1, body.steps, actorId));
  if (stepError) { await admin.from('workflow_definitions').delete().eq('id', data.id); return c.json(fail(reqId, 'WORKFLOW_STEPS_CREATE_FAILED', stepError.message), 400); }
  if (body.isDefault) {
    await admin.from('workflow_definitions').update({ is_default: false }).eq('module_key', body.moduleKey).neq('id', data.id);
    await admin.from('workflow_definitions').update({ is_default: true }).eq('id', data.id);
    data.is_default = true;
  }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'CREATE', module: 'workflow', targetTable: 'workflow_definitions', targetId: data.id, detail: { workflowCode: body.workflowCode, version: 1, steps: body.steps.length }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

workflowsRoute.patch('/definitions/:id', requirePermission('workflow.manage'), zValidator('json', updateWorkflowDefinitionSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const id = c.req.param('id')!; const body = c.req.valid('json'); const admin = createAdminClient(c.env);
  const { data: current } = await admin.from('workflow_definitions').select('*').eq('id', id).maybeSingle(); if (!current) return c.json(fail(reqId, 'WORKFLOW_DEFINITION_NOT_FOUND', 'ไม่พบแบบ Workflow'), 404);
  const invalid = await validateSteps(admin, body.steps); if (invalid) return c.json(fail(reqId, 'WORKFLOW_STEP_REFERENCE_INVALID', invalid), 400);
  const version = current.version + 1;
  const { error: stepError } = await admin.from('workflow_steps').insert(stepRows(id, version, body.steps, actorId)); if (stepError) return c.json(fail(reqId, 'WORKFLOW_STEPS_CREATE_FAILED', stepError.message), 400);
  if (body.isDefault) await admin.from('workflow_definitions').update({ is_default: false }).eq('module_key', body.moduleKey).neq('id', id);
  const { data, error } = await admin.from('workflow_definitions').update({ workflow_name: body.workflowName, module_key: body.moduleKey, description: body.description ?? null, version, trigger_event: body.triggerEvent ?? 'MANUAL', sla_hours: body.slaHours, is_default: body.isDefault, status: body.status, active_from: body.activeFrom ?? null, active_to: body.activeTo ?? null, notes: body.notes ?? null, updated_by: actorId }).eq('id', id).select('*').single();
  if (error) { await admin.from('workflow_steps').delete().eq('definition_id', id).eq('definition_version', version); return c.json(fail(reqId, 'WORKFLOW_DEFINITION_UPDATE_FAILED', error.message), 400); }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'UPDATE', module: 'workflow', targetTable: 'workflow_definitions', targetId: id, detail: { version, steps: body.steps.length }, requestId: reqId });
  return c.json(ok(reqId, data));
});

workflowsRoute.post('/instances', requirePermission('workflow.manage'), zValidator('json', startWorkflowSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const body = c.req.valid('json'); const admin = createAdminClient(c.env);
  const { data: definition } = await admin.from('workflow_definitions').select('*').eq('id', body.definitionId).eq('status', 'ใช้งาน').maybeSingle(); if (!definition) return c.json(fail(reqId, 'WORKFLOW_DEFINITION_INACTIVE', 'ไม่พบแบบ Workflow ที่เปิดใช้งาน'), 404);
  if (body.idempotencyKey) { const { data: duplicate } = await admin.from('workflow_instances').select('*').eq('idempotency_key', body.idempotencyKey).maybeSingle(); if (duplicate) return c.json(ok(reqId, duplicate)); }
  const { data: steps, error: stepsError } = await admin.from('workflow_steps').select('*').eq('definition_id', definition.id).eq('definition_version', definition.version).eq('status', 'ใช้งาน').order('step_order');
  if (stepsError || !steps?.length) return c.json(fail(reqId, 'WORKFLOW_STEPS_NOT_FOUND', stepsError?.message ?? 'แบบ Workflow ไม่มีขั้นอนุมัติ'), 400);
  const { data: instance, error } = await admin.from('workflow_instances').insert({ instance_code: code('WF'), definition_id: definition.id, definition_version: definition.version, module_key: definition.module_key, record_id: body.recordId, record_label: body.recordLabel, requester_id: actorId, status: 'กำลังดำเนินการ', started_at: new Date().toISOString(), due_at: addHours(definition.sla_hours), context: body.context, result: {}, idempotency_key: body.idempotencyKey ?? null, notes: body.notes ?? null, created_by: actorId, updated_by: actorId }).select('*').single();
  if (error) return c.json(fail(reqId, 'WORKFLOW_START_FAILED', error.message), 400);
  try { await history(admin, instance.id, 'START', actorId, { status_to: 'กำลังดำเนินการ', detail: { definitionCode: definition.workflow_code, version: definition.version } }); await activateStep(admin, c.env, instance, steps[0], actorId); }
  catch (reason) { await admin.from('workflow_instances').delete().eq('id', instance.id); return c.json(fail(reqId, 'WORKFLOW_ACTIVATION_FAILED', reason instanceof Error ? reason.message : 'เปิดขั้นอนุมัติไม่สำเร็จ'), 400); }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'START', module: 'workflow', targetTable: 'workflow_instances', targetId: instance.id, detail: { definitionId: definition.id, recordId: body.recordId }, requestId: reqId });
  return c.json(ok(reqId, instance), 201);
});

workflowsRoute.post('/approvals/:id/decision', requirePermission('workflow.approve'), zValidator('json', workflowDecisionSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const id = c.req.param('id')!; const body = c.req.valid('json'); const admin = createAdminClient(c.env);
  const { data: approval } = await admin.from('workflow_approvals').select('*').eq('id', id).maybeSingle(); if (!approval) return c.json(fail(reqId, 'WORKFLOW_APPROVAL_NOT_FOUND', 'ไม่พบงานอนุมัติ'), 404);
  if (approval.status !== 'รอพิจารณา') return c.json(fail(reqId, 'WORKFLOW_APPROVAL_ALREADY_DECIDED', 'งานอนุมัตินี้ถูกดำเนินการแล้ว'), 409);
  if (approval.approver_id !== actorId) return c.json(fail(reqId, 'WORKFLOW_APPROVER_MISMATCH', 'งานนี้ไม่ได้มอบหมายให้ท่าน'), 403);
  const [{ data: instance }, { data: step }] = await Promise.all([admin.from('workflow_instances').select('*').eq('id', approval.instance_id).maybeSingle(), admin.from('workflow_steps').select('*').eq('id', approval.step_id).maybeSingle()]);
  if (!instance || !step || instance.status !== 'กำลังดำเนินการ') return c.json(fail(reqId, 'WORKFLOW_INSTANCE_INACTIVE', 'Workflow ไม่อยู่ในสถานะดำเนินการ'), 409);
  if (body.decision === 'RETURN' && !step.allow_return) return c.json(fail(reqId, 'WORKFLOW_RETURN_NOT_ALLOWED', 'ขั้นนี้ไม่อนุญาตให้ส่งกลับแก้ไข'), 400);
  const approvalStatus = workflowDecisionStatus(body.decision);
  const { data: updated, error } = await admin.from('workflow_approvals').update({ status: approvalStatus, decision: body.decision, comment: body.comment ?? null, decided_at: new Date().toISOString(), decision_by: actorId, updated_by: actorId }).eq('id', id).eq('status', 'รอพิจารณา').select('id').maybeSingle();
  if (error) return c.json(fail(reqId, 'WORKFLOW_DECISION_FAILED', error.message), 400);
  if (!updated) return c.json(fail(reqId, 'WORKFLOW_APPROVAL_ALREADY_DECIDED', 'งานอนุมัตินี้ถูกดำเนินการแล้ว'), 409);
  await history(admin, instance.id, 'DECISION', actorId, { approval_id: id, step_order: approval.step_order, status_from: 'รอพิจารณา', status_to: approvalStatus, comment: body.comment, detail: { decision: body.decision } });
  if (body.decision !== 'APPROVE') {
    const terminal = body.decision === 'REJECT' ? 'ปฏิเสธ' : 'ส่งกลับแก้ไข';
    await Promise.all([admin.from('workflow_instances').update({ status: terminal, completed_at: new Date().toISOString(), result: { decision: body.decision, comment: body.comment }, updated_by: actorId }).eq('id', instance.id), admin.from('workflow_approvals').update({ status: 'ยกเลิก', updated_by: actorId }).eq('instance_id', instance.id).eq('status', 'รอพิจารณา')]);
    await history(admin, instance.id, 'COMPLETE', actorId, { step_order: approval.step_order, status_from: 'กำลังดำเนินการ', status_to: terminal, comment: body.comment });
    await sendNotification(c.env, { recipientId: instance.requester_id, type: 'workflow_result', title: `${terminal}: ${instance.record_label}`, body: body.comment ?? instance.instance_code, link: '/workflows' });
  } else {
    const { data: stepApprovals } = await admin.from('workflow_approvals').select('*').eq('instance_id', instance.id).eq('step_order', approval.step_order);
    const rows = stepApprovals ?? []; const approved = rows.filter((item) => item.status === 'อนุมัติ').length;
    const required = requiredWorkflowApprovals(step.mode, step.min_approvals, rows.length);
    if (approved >= required) {
      await admin.from('workflow_approvals').update({ status: 'ข้าม', updated_by: actorId }).eq('instance_id', instance.id).eq('step_order', approval.step_order).eq('status', 'รอพิจารณา');
      const { data: next } = await admin.from('workflow_steps').select('*').eq('definition_id', instance.definition_id).eq('definition_version', instance.definition_version).eq('status', 'ใช้งาน').gt('step_order', approval.step_order).order('step_order').limit(1).maybeSingle();
      if (next) await activateStep(admin, c.env, instance, next, actorId);
      else {
        await admin.from('workflow_instances').update({ status: 'อนุมัติแล้ว', completed_at: new Date().toISOString(), result: { decision: 'APPROVE' }, updated_by: actorId }).eq('id', instance.id);
        await history(admin, instance.id, 'COMPLETE', actorId, { step_order: approval.step_order, status_from: 'กำลังดำเนินการ', status_to: 'อนุมัติแล้ว', comment: body.comment });
        await sendNotification(c.env, { recipientId: instance.requester_id, type: 'workflow_result', title: `อนุมัติแล้ว: ${instance.record_label}`, body: instance.instance_code, link: '/workflows' });
      }
    }
  }
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: body.decision, module: 'workflow', targetTable: 'workflow_approvals', targetId: id, detail: { instanceId: instance.id, stepOrder: approval.step_order }, requestId: reqId });
  return c.json(ok(reqId, { id, status: approvalStatus }));
});

workflowsRoute.post('/delegations', requirePermission('workflow.delegate'), zValidator('json', createWorkflowDelegationSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const body = c.req.valid('json'); const admin = createAdminClient(c.env);
  if (body.delegateId === actorId) return c.json(fail(reqId, 'WORKFLOW_DELEGATION_SELF', 'ไม่สามารถมอบหมายงานให้ตนเอง'), 400);
  const { data: delegate } = await admin.from('profiles').select('id').eq('id', body.delegateId).eq('status', 'active').maybeSingle(); if (!delegate) return c.json(fail(reqId, 'WORKFLOW_DELEGATE_NOT_FOUND', 'ไม่พบผู้รับงานแทนที่ใช้งานอยู่'), 404);
  if (body.definitionId) { const { data: definition } = await admin.from('workflow_definitions').select('module_key').eq('id', body.definitionId).maybeSingle(); if (!definition) return c.json(fail(reqId, 'WORKFLOW_DEFINITION_NOT_FOUND', 'ไม่พบแบบ Workflow'), 404); if (body.moduleKey && definition.module_key !== body.moduleKey) return c.json(fail(reqId, 'WORKFLOW_DELEGATION_SCOPE_INVALID', 'Module ไม่ตรงกับแบบ Workflow'), 400); }
  const { data: overlaps } = await admin.from('workflow_delegations').select('id').eq('delegator_id', actorId).eq('status', 'Active').lt('start_at', body.endAt).gt('end_at', body.startAt);
  if (overlaps?.length) return c.json(fail(reqId, 'WORKFLOW_DELEGATION_OVERLAP', 'มีช่วงมอบหมายงานแทนที่ทับซ้อนอยู่แล้ว'), 409);
  const { data, error } = await admin.from('workflow_delegations').insert({ delegator_id: actorId, delegate_id: body.delegateId, module_key: body.moduleKey ?? null, definition_id: body.definitionId ?? null, start_at: body.startAt, end_at: body.endAt, reason: body.reason, status: 'Active', created_by: actorId, updated_by: actorId }).select('*').single();
  if (error) return c.json(fail(reqId, 'WORKFLOW_DELEGATION_CREATE_FAILED', error.message), 400);
  await writeAuditLog(c.env, { actorId, actorEmail: c.get('userEmail'), action: 'DELEGATE', module: 'workflow', targetTable: 'workflow_delegations', targetId: data.id, detail: { delegateId: body.delegateId, startAt: body.startAt, endAt: body.endAt }, requestId: reqId });
  return c.json(ok(reqId, data), 201);
});

workflowsRoute.post('/delegations/:id/revoke', requirePermission('workflow.delegate'), zValidator('json', revokeWorkflowDelegationSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const id = c.req.param('id')!; const body = c.req.valid('json'); const admin = createAdminClient(c.env);
  const { data: row } = await admin.from('workflow_delegations').select('*').eq('id', id).maybeSingle(); if (!row) return c.json(fail(reqId, 'WORKFLOW_DELEGATION_NOT_FOUND', 'ไม่พบการมอบหมายแทน'), 404);
  const canManage = await hasPermission(c, 'workflow.manage'); if (row.delegator_id !== actorId && !canManage) return c.json(fail(reqId, 'WORKFLOW_DELEGATION_REVOKE_DENIED', 'ยกเลิกได้เฉพาะผู้มอบหมายหรือผู้ดูแล'), 403);
  const { data, error } = await admin.from('workflow_delegations').update({ status: 'Revoked', revoked_at: new Date().toISOString(), revoked_by: actorId, revoke_reason: body.reason, updated_by: actorId }).eq('id', id).eq('status', 'Active').select('*').single();
  if (error) return c.json(fail(reqId, 'WORKFLOW_DELEGATION_REVOKE_FAILED', error.message), 400);
  return c.json(ok(reqId, data));
});

workflowsRoute.post('/instances/:id/cancel', requirePermission('workflow.view'), zValidator('json', cancelWorkflowSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId'); const actorId = c.get('userId'); const id = c.req.param('id')!; const body = c.req.valid('json'); const admin = createAdminClient(c.env);
  const { data: instance } = await admin.from('workflow_instances').select('*').eq('id', id).maybeSingle(); if (!instance) return c.json(fail(reqId, 'WORKFLOW_INSTANCE_NOT_FOUND', 'ไม่พบ Workflow'), 404);
  const canManage = await hasPermission(c, 'workflow.manage'); if (instance.requester_id !== actorId && !canManage) return c.json(fail(reqId, 'WORKFLOW_CANCEL_DENIED', 'ยกเลิกได้เฉพาะผู้ขอหรือผู้ดูแล'), 403);
  if (instance.status !== 'กำลังดำเนินการ') return c.json(fail(reqId, 'WORKFLOW_INSTANCE_INACTIVE', 'Workflow สิ้นสุดแล้ว'), 409);
  await Promise.all([admin.from('workflow_instances').update({ status: 'ยกเลิก', cancelled_at: new Date().toISOString(), result: { reason: body.reason }, updated_by: actorId }).eq('id', id), admin.from('workflow_approvals').update({ status: 'ยกเลิก', updated_by: actorId }).eq('instance_id', id).eq('status', 'รอพิจารณา')]);
  await history(admin, id, 'CANCEL', actorId, { status_from: 'กำลังดำเนินการ', status_to: 'ยกเลิก', comment: body.reason });
  return c.json(ok(reqId, { id, status: 'ยกเลิก' }));
});
