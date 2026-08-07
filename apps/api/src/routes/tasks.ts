import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { fail, ok } from '../utils/response';
import { zodValidationHook } from '../utils/validation';
import {
  addTaskLinkSchema,
  addTaskProgressLogSchema,
  addTaskSubtaskSchema,
  createTaskSchema,
  listTasksQuerySchema,
  setTaskBoardStateSchema,
  setTaskDueDateSchema,
  setTaskStatusSchema,
  setTaskSubtaskStatusSchema,
  updateTaskSchema,
} from '../validators/tasks';

/**
 * Task / งานของฉัน — สืบทอดจาก PersonalTasks/TaskSubtasks/TaskProgressLogs/TaskLinks เดิม
 * (Module_Task.gs) ข้อมูลส่วนตัวล้วน RLS (personal_tasks_all_own ฯลฯ ใน migration) จำกัดด้วย
 * owner_id = auth.uid() เท่านั้น — ไม่มี staff-bypass ใดๆ จึงมี Permission เดียว (task.view) สำหรับ
 * เปิด/ปิดเมนูทั้งโมดู ไม่ต้องแยก .create/.update เหมือนโมดูลอื่นเพราะทุกคนจัดการได้แค่ของตนเองอยู่แล้ว
 * ขอบเขตที่ตัดออก (TaskReminders, Attachments UI, Calendar drag) ดูใน header comment ของ
 * supabase/migrations/20260813100000_tasks.sql
 */
export const tasksRoute = new Hono<AppEnv>();
tasksRoute.use('*', requireAuth);
tasksRoute.use('*', requirePermission('task.view'));

const TERMINAL_STATUSES = new Set(['เสร็จแล้ว', 'ยกเลิก']);
const PRIORITY_RANK: Record<string, number> = { เร่งด่วน: 0, สูง: 1, ปกติ: 2, ต่ำ: 3 };

interface TaskRow {
  id: string;
  status: string;
  priority: string;
  due_date: string | null;
  updated_at: string;
  [key: string]: unknown;
}

function daysUntil(dueDate: string | null): number | null {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T12:00:00Z`);
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12);
  return Math.round((due.getTime() - todayUtc) / 86400000);
}

function sortTasks(list: TaskRow[]): TaskRow[] {
  return [...list].sort((a, b) => {
    const terminalA = TERMINAL_STATUSES.has(a.status) ? 1 : 0;
    const terminalB = TERMINAL_STATUSES.has(b.status) ? 1 : 0;
    if (terminalA !== terminalB) return terminalA - terminalB;

    const dueA = daysUntil(a.due_date) ?? 999999;
    const dueB = daysUntil(b.due_date) ?? 999999;
    if (dueA !== dueB) return dueA - dueB;

    const priorityA = PRIORITY_RANK[a.priority] ?? 9;
    const priorityB = PRIORITY_RANK[b.priority] ?? 9;
    if (priorityA !== priorityB) return priorityA - priorityB;

    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

function isGoogleDriveLocator(url: string): boolean {
  return /^https:\/\/(?:drive\.google\.com|docs\.google\.com)(?:\/|$)/i.test(url.trim());
}

function nextRecurrenceDate(dateStr: string | null, recurrence: string): string | null {
  if (!dateStr || recurrence === 'ไม่ทำซ้ำ') return null;
  const d = new Date(`${dateStr}T12:00:00Z`);
  switch (recurrence) {
    case 'รายวัน':
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case 'รายสัปดาห์':
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case 'รายเดือน':
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case 'รายไตรมาส':
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case 'รายปี':
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
    default:
      return null;
  }
  return d.toISOString().slice(0, 10);
}

/** ใช้หลังปรับสถานะเป็น "เสร็จแล้ว" — สร้างงานรอบถัดไปให้อัตโนมัติถ้าตั้ง recurrence ไว้ (ข้าม ถ้ามีอยู่แล้ว) */
async function createNextRecurringTask(c: Context<AppEnv>, task: Record<string, unknown>): Promise<void> {
  const supabase = c.get('supabase');
  const actorId = c.get('userId');
  const recurrence = String(task.recurrence ?? 'ไม่ทำซ้ำ');
  const nextDue = nextRecurrenceDate((task.due_date as string) ?? null, recurrence);
  if (!nextDue) return;
  const endDate = task.recurrence_end_date as string | null;
  if (endDate && nextDue > endDate) return;

  const parentId = (task.recurring_parent_id as string | null) ?? (task.id as string);
  const { data: existing } = await supabase
    .from('personal_tasks')
    .select('id')
    .eq('recurring_parent_id', parentId)
    .eq('due_date', nextDue)
    .maybeSingle();
  if (existing) return;

  const nextStart = task.start_date ? nextRecurrenceDate(task.start_date as string, recurrence) : null;
  await supabase.from('personal_tasks').insert({
    owner_id: actorId,
    title: task.title,
    description: task.description,
    category: task.category,
    priority: task.priority,
    status: 'ต้องทำ',
    start_date: nextStart,
    due_date: nextDue,
    progress: 0,
    tags: task.tags,
    notes: task.notes,
    sort_order: Date.now(),
    recurrence,
    recurrence_end_date: endDate,
    recurring_parent_id: parentId,
    created_by: actorId,
  });
}

async function loadTaskOr404(c: Context<AppEnv>, id: string) {
  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('personal_tasks').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data;
}

tasksRoute.get('/', zValidator('query', listTasksQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { status, category, search } = c.req.valid('query');

  // RLS (personal_tasks_all_own) เป็นตัวกรองสิทธิ์การมองเห็นจริง — เห็นเฉพาะของตนเองเสมอ
  let query = supabase.from('personal_tasks').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (category) query = query.eq('category', category);
  if (search) query = query.ilike('title', `%${search}%`);

  const { data: tasks, error } = await query;
  if (error) {
    return c.json(fail(reqId, 'TASKS_LIST_FAILED', 'ดึงรายการงานไม่สำเร็จ'), 400);
  }

  const ids = (tasks ?? []).map((t) => t.id as string);
  const [{ data: subtasks }, { data: links }, { data: logs }] = ids.length
    ? await Promise.all([
        supabase.from('task_subtasks').select('*').in('task_id', ids).order('sort_order', { ascending: true }),
        supabase.from('task_links').select('*').in('task_id', ids).order('created_at', { ascending: true }),
        supabase.from('task_progress_logs').select('*').in('task_id', ids).order('logged_at', { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const byTask: Record<string, { subtasks: unknown[]; links: unknown[]; progressLogs: unknown[] }> = {};
  for (const id of ids) byTask[id] = { subtasks: [], links: [], progressLogs: [] };
  for (const row of subtasks ?? []) byTask[row.task_id as string]?.subtasks.push(row);
  for (const row of links ?? []) byTask[row.task_id as string]?.links.push(row);
  for (const row of logs ?? []) byTask[row.task_id as string]?.progressLogs.push(row);

  const enriched = sortTasks((tasks ?? []) as TaskRow[]).map((t) => ({
    ...t,
    due_days: daysUntil(t.due_date),
    ...byTask[t.id],
  }));

  return c.json(ok(reqId, enriched));
});

tasksRoute.get('/:id', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;

  const task = await loadTaskOr404(c, id);
  if (!task) {
    return c.json(fail(reqId, 'TASK_NOT_FOUND', 'ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const [{ data: subtasks }, { data: links }, { data: logs }] = await Promise.all([
    supabase.from('task_subtasks').select('*').eq('task_id', id).order('sort_order', { ascending: true }),
    supabase.from('task_links').select('*').eq('task_id', id).order('created_at', { ascending: true }),
    supabase.from('task_progress_logs').select('*').eq('task_id', id).order('logged_at', { ascending: false }),
  ]);

  return c.json(
    ok(reqId, {
      ...task,
      due_days: daysUntil(task.due_date),
      subtasks: subtasks ?? [],
      links: links ?? [],
      progressLogs: logs ?? [],
    }),
  );
});

tasksRoute.post('/', zValidator('json', createTaskSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const body = c.req.valid('json');

  let status = body.status ?? 'ต้องทำ';
  let progress = body.progress ?? 0;
  let completedAt: string | null = null;
  if (status === 'ยกเลิก') {
    completedAt = null;
  } else if (status === 'เสร็จแล้ว' || progress === 100) {
    status = 'เสร็จแล้ว';
    progress = 100;
    completedAt = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('personal_tasks')
    .insert({
      owner_id: actorId,
      title: body.title,
      description: body.description ?? null,
      category: body.category ?? 'งานทั่วไป',
      priority: body.priority ?? 'ปกติ',
      status,
      start_date: body.startDate || null,
      due_date: body.dueDate || null,
      completed_at: completedAt,
      progress,
      tags: body.tags ?? null,
      notes: body.notes ?? null,
      sort_order: Date.now(),
      recurrence: body.recurrence ?? 'ไม่ทำซ้ำ',
      recurrence_end_date: body.recurrenceEndDate || null,
      created_by: actorId,
    })
    .select()
    .single();

  if (error) {
    return c.json(fail(reqId, 'TASK_CREATE_FAILED', error.message), 400);
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CREATE',
    module: 'task',
    targetTable: 'personal_tasks',
    targetId: data.id,
    detail: { category: data.category, priority: data.priority, status: data.status },
    requestId: reqId,
  });

  return c.json(ok(reqId, data), 201);
});

tasksRoute.patch('/:id', zValidator('json', updateTaskSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');

  const current = await loadTaskOr404(c, id);
  if (!current) {
    return c.json(fail(reqId, 'TASK_NOT_FOUND', 'ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  let status = body.status ?? String(current.status);
  let progress = body.progress ?? (Number(current.progress) || 0);
  let completedAt: string | null = null;
  if (status === 'ยกเลิก') {
    completedAt = null;
  } else if (status === 'เสร็จแล้ว' || progress === 100) {
    status = 'เสร็จแล้ว';
    progress = 100;
    completedAt = (current.completed_at as string | null) ?? new Date().toISOString();
  }

  const supabase = c.get('supabase');
  const { data: updated, error } = await supabase
    .from('personal_tasks')
    .update({
      title: body.title,
      description: body.description ?? null,
      category: body.category ?? 'งานทั่วไป',
      priority: body.priority ?? 'ปกติ',
      status,
      start_date: body.startDate || null,
      due_date: body.dueDate || null,
      completed_at: completedAt,
      progress,
      tags: body.tags ?? null,
      notes: body.notes ?? null,
      recurrence: body.recurrence ?? 'ไม่ทำซ้ำ',
      recurrence_end_date: body.recurrenceEndDate || null,
      updated_by: actorId,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return c.json(fail(reqId, 'TASK_UPDATE_FAILED', error.message), 400);
  }

  if (status === 'เสร็จแล้ว') await createNextRecurringTask(c, updated);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE',
    module: 'task',
    targetTable: 'personal_tasks',
    targetId: id,
    detail: { category: updated.category, priority: updated.priority, status: updated.status, progress: updated.progress },
    requestId: reqId,
  });

  return c.json(ok(reqId, updated));
});

tasksRoute.post('/:id/status', zValidator('json', setTaskStatusSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { status } = c.req.valid('json');

  const current = await loadTaskOr404(c, id);
  if (!current) {
    return c.json(fail(reqId, 'TASK_NOT_FOUND', 'ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const patch: Record<string, unknown> = { status, updated_by: actorId };
  const currentProgress = Number(current.progress) || 0;
  if (status === 'เสร็จแล้ว') {
    patch.progress = 100;
    patch.completed_at = current.completed_at ?? new Date().toISOString();
  } else if (status === 'กำลังทำ') {
    patch.progress = currentProgress > 0 && currentProgress < 100 ? currentProgress : 10;
    patch.completed_at = null;
  } else if (status === 'ต้องทำ') {
    patch.progress = TERMINAL_STATUSES.has(String(current.status)) ? 0 : Math.min(currentProgress, 99);
    patch.completed_at = null;
  } else {
    patch.progress = Math.min(currentProgress, 99);
    patch.completed_at = null;
  }

  const supabase = c.get('supabase');
  const { data: updated, error } = await supabase.from('personal_tasks').update(patch).eq('id', id).select().single();
  if (error) {
    return c.json(fail(reqId, 'TASK_STATUS_UPDATE_FAILED', error.message), 400);
  }

  if (status === 'เสร็จแล้ว') await createNextRecurringTask(c, updated);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE_STATUS',
    module: 'task',
    targetTable: 'personal_tasks',
    targetId: id,
    detail: { from: current.status, to: status },
    requestId: reqId,
  });

  return c.json(ok(reqId, updated));
});

/** ใช้โดย Kanban board (ลากการ์ดข้ามคอลัมน์/จัดลำดับใหม่) — ไม่มี audit log แยก เหมือนระบบเดิม */
tasksRoute.post('/:id/board', zValidator('json', setTaskBoardStateSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { status, sortOrder } = c.req.valid('json');

  const current = await loadTaskOr404(c, id);
  if (!current) {
    return c.json(fail(reqId, 'TASK_NOT_FOUND', 'ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const currentProgress = Number(current.progress) || (status === 'กำลังทำ' ? 10 : 0);
  const patch = {
    status,
    sort_order: sortOrder,
    progress: status === 'เสร็จแล้ว' ? 100 : Math.min(currentProgress, 99),
    completed_at: status === 'เสร็จแล้ว' ? (current.completed_at ?? new Date().toISOString()) : null,
    updated_by: actorId,
  };

  const supabase = c.get('supabase');
  const { data: updated, error } = await supabase.from('personal_tasks').update(patch).eq('id', id).select().single();
  if (error) {
    return c.json(fail(reqId, 'TASK_BOARD_UPDATE_FAILED', error.message), 400);
  }

  if (status === 'เสร็จแล้ว') await createNextRecurringTask(c, updated);

  return c.json(ok(reqId, updated));
});

/** ใช้โดย Calendar view ในอนาคต (ลากวันครบกำหนด) — เลื่อนเฉพาะ due_date เท่านั้น */
tasksRoute.post('/:id/due-date', zValidator('json', setTaskDueDateSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { dueDate } = c.req.valid('json');

  const current = await loadTaskOr404(c, id);
  if (!current) {
    return c.json(fail(reqId, 'TASK_NOT_FOUND', 'ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }
  if (current.start_date && dueDate && dueDate < (current.start_date as string)) {
    return c.json(fail(reqId, 'VALIDATION_ERROR', 'วันครบกำหนดต้องไม่น้อยกว่าวันที่เริ่ม', [{ field: 'dueDate', message: 'ไม่ถูกต้อง' }]), 400);
  }

  const supabase = c.get('supabase');
  const { data: updated, error } = await supabase
    .from('personal_tasks')
    .update({ due_date: dueDate || null, updated_by: actorId })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    return c.json(fail(reqId, 'TASK_DUE_DATE_UPDATE_FAILED', error.message), 400);
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE_DUE',
    module: 'task',
    targetTable: 'personal_tasks',
    targetId: id,
    detail: { dueDate: dueDate || null },
    requestId: reqId,
  });

  return c.json(ok(reqId, updated));
});

tasksRoute.post('/:id/restore', async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;

  const current = await loadTaskOr404(c, id);
  if (!current) {
    return c.json(fail(reqId, 'TASK_NOT_FOUND', 'ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }
  if (current.status !== 'ยกเลิก') {
    return c.json(fail(reqId, 'TASK_NOT_CANCELLED', 'กู้คืนได้เฉพาะงานที่ยกเลิกแล้ว'), 400);
  }

  const supabase = c.get('supabase');
  const { data: updated, error } = await supabase
    .from('personal_tasks')
    .update({ status: 'ต้องทำ', completed_at: null, progress: Math.min(Number(current.progress) || 0, 99), updated_by: actorId })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    return c.json(fail(reqId, 'TASK_RESTORE_FAILED', error.message), 400);
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'RESTORE',
    module: 'task',
    targetTable: 'personal_tasks',
    targetId: id,
    requestId: reqId,
  });

  return c.json(ok(reqId, updated));
});

tasksRoute.post('/:id/progress-logs', zValidator('json', addTaskProgressLogSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');

  const current = await loadTaskOr404(c, id);
  if (!current) {
    return c.json(fail(reqId, 'TASK_NOT_FOUND', 'ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const progress = body.progress ?? (Number(current.progress) || 0);
  const now = new Date().toISOString();

  const { data: log, error: logError } = await supabase
    .from('task_progress_logs')
    .insert({ task_id: id, owner_id: actorId, progress, note: body.note, logged_at: now })
    .select()
    .single();
  if (logError) {
    return c.json(fail(reqId, 'TASK_PROGRESS_LOG_FAILED', logError.message), 400);
  }

  const patch: Record<string, unknown> = { progress, updated_by: actorId };
  if (progress === 100) {
    patch.status = 'เสร็จแล้ว';
    patch.completed_at = current.completed_at ?? now;
  } else if (current.status === 'ต้องทำ' && progress > 0) {
    patch.status = 'กำลังทำ';
  }
  const { error: updateError } = await supabase.from('personal_tasks').update(patch).eq('id', id);
  if (updateError) {
    return c.json(fail(reqId, 'TASK_PROGRESS_LOG_FAILED', updateError.message), 400);
  }

  return c.json(ok(reqId, log), 201);
});

tasksRoute.post('/:id/links', zValidator('json', addTaskLinkSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');

  const current = await loadTaskOr404(c, id);
  if (!current) {
    return c.json(fail(reqId, 'TASK_NOT_FOUND', 'ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }
  if (isGoogleDriveLocator(body.url)) {
    return c.json(fail(reqId, 'TASK_LINK_DRIVE_NOT_ALLOWED', 'กรุณาแนบไฟล์ Google Drive/Docs ผ่านระบบอัปโหลดไฟล์แทนการวางลิงก์'), 400);
  }

  const { data, error } = await supabase
    .from('task_links')
    .insert({ task_id: id, owner_id: actorId, label: body.label || body.url, url: body.url })
    .select()
    .single();
  if (error) {
    return c.json(fail(reqId, 'TASK_LINK_CREATE_FAILED', error.message), 400);
  }

  return c.json(ok(reqId, data), 201);
});

tasksRoute.post('/:id/subtasks', zValidator('json', addTaskSubtaskSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');

  const current = await loadTaskOr404(c, id);
  if (!current) {
    return c.json(fail(reqId, 'TASK_NOT_FOUND', 'ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const { data, error } = await supabase
    .from('task_subtasks')
    .insert({
      task_id: id,
      owner_id: actorId,
      title: body.title,
      status: 'ต้องทำ',
      due_date: body.dueDate || null,
      sort_order: Date.now(),
      notes: body.notes ?? null,
    })
    .select()
    .single();
  if (error) {
    return c.json(fail(reqId, 'TASK_SUBTASK_CREATE_FAILED', error.message), 400);
  }

  return c.json(ok(reqId, data), 201);
});

tasksRoute.patch('/subtasks/:subtaskId', zValidator('json', setTaskSubtaskStatusSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const subtaskId = c.req.param('subtaskId')!;
  const { status } = c.req.valid('json');

  const { data: updated, error } = await supabase
    .from('task_subtasks')
    .update({ status, completed_at: status === 'เสร็จแล้ว' ? new Date().toISOString() : null })
    .eq('id', subtaskId)
    .select()
    .maybeSingle();
  if (error) {
    return c.json(fail(reqId, 'TASK_SUBTASK_UPDATE_FAILED', error.message), 400);
  }
  if (!updated) {
    return c.json(fail(reqId, 'TASK_SUBTASK_NOT_FOUND', 'ไม่พบรายการย่อยนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  return c.json(ok(reqId, updated));
});

tasksRoute.post('/subtasks/:subtaskId/cancel', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const subtaskId = c.req.param('subtaskId')!;

  const { data: updated, error } = await supabase
    .from('task_subtasks')
    .update({ status: 'ยกเลิก', completed_at: null })
    .eq('id', subtaskId)
    .select()
    .maybeSingle();
  if (error) {
    return c.json(fail(reqId, 'TASK_SUBTASK_CANCEL_FAILED', error.message), 400);
  }
  if (!updated) {
    return c.json(fail(reqId, 'TASK_SUBTASK_NOT_FOUND', 'ไม่พบรายการย่อยนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  return c.json(ok(reqId, updated));
});
