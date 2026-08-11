import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { writeAuditLog } from '../services/auditService';
import type { AppEnv } from '../types';
import { fail, ok } from '../utils/response';
import {
  addDaysToDateKey,
  buildTaskDashboard,
  calculateChecklistProgress,
  daysFromBangkokToday,
  nextRecurrenceDate,
  resolveRecurrenceRule,
  type TaskRecurrenceRule,
} from '../utils/taskBusiness';
import { zodValidationHook } from '../utils/validation';
import {
  addTaskLinkSchema,
  addTaskProgressLogSchema,
  addTaskSubtaskSchema,
  createTaskSchema,
  listTasksQuerySchema,
  reorderTaskSubtaskSchema,
  setTaskReminderSchema,
  setTaskBoardStateSchema,
  setTaskDueDateSchema,
  setTaskPrioritySchema,
  setTaskStatusSchema,
  setTaskSubtaskStatusSchema,
  snoozeTaskReminderSchema,
  updateTaskSchema,
  updateTaskSubtaskSchema,
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
  due_time: string | null;
  progress: number;
  updated_at: string;
  [key: string]: unknown;
}

function daysUntil(dueDate: string | null): number | null {
  return daysFromBangkokToday(dueDate);
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

/** ใช้หลังปรับสถานะเป็น "เสร็จแล้ว" — สร้างงานรอบถัดไปให้อัตโนมัติถ้าตั้ง recurrence ไว้ (ข้าม ถ้ามีอยู่แล้ว) */
async function createNextRecurringTask(c: Context<AppEnv>, task: Record<string, unknown>): Promise<void> {
  const supabase = c.get('supabase');
  const actorId = c.get('userId');
  const recurrence = String(task.recurrence ?? 'ไม่ทำซ้ำ');
  const recurrenceRule = resolveRecurrenceRule(
    recurrence,
    (task.recurrence_rule as TaskRecurrenceRule | null) ?? null,
    (task.due_date as string | null) ?? null,
  );
  const nextDue = nextRecurrenceDate((task.due_date as string) ?? null, recurrenceRule);
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

  const nextStart = task.start_date && task.due_date
    ? addDaysToDateKey(nextDue, Math.round((Date.parse(`${task.start_date as string}T12:00:00Z`) - Date.parse(`${task.due_date as string}T12:00:00Z`)) / 86_400_000))
    : null;
  const { data: nextTask, error: insertError } = await supabase.from('personal_tasks').insert({
    owner_id: actorId,
    title: task.title,
    description: task.description,
    task_type: task.task_type ?? 'general',
    category: task.category,
    priority: task.priority,
    status: 'ต้องทำ',
    start_date: nextStart,
    start_time: task.start_time ?? null,
    due_date: nextDue,
    due_time: task.due_time ?? null,
    progress: 0,
    tags: task.tags,
    notes: task.notes,
    sort_order: Date.now(),
    recurrence,
    recurrence_rule: recurrenceRule,
    recurrence_end_date: endDate,
    recurring_parent_id: parentId,
    created_by: actorId,
  }).select('id').single();
  if (insertError || !nextTask) return;

  const { data: checklist } = await supabase
    .from('task_subtasks')
    .select('title,due_date,sort_order,notes')
    .eq('task_id', task.id as string)
    .neq('status', 'ยกเลิก')
    .order('sort_order', { ascending: true });
  if (checklist?.length) {
    await supabase.from('task_subtasks').insert(checklist.map((item) => ({
      task_id: nextTask.id,
      owner_id: actorId,
      title: item.title,
      status: 'ต้องทำ',
      due_date: item.due_date && task.due_date
        ? addDaysToDateKey(nextDue, Math.round((Date.parse(`${item.due_date}T12:00:00Z`) - Date.parse(`${task.due_date as string}T12:00:00Z`)) / 86_400_000))
        : null,
      sort_order: item.sort_order,
      notes: item.notes,
    })));
  }

  const { data: sourceReminder } = await supabase
    .from('task_reminders')
    .select('remind_at,preset')
    .eq('task_id', task.id as string)
    .neq('status', 'cancelled')
    .maybeSingle();
  if (sourceReminder && task.due_date) {
    const sourceDue = Date.parse(`${task.due_date as string}T${String(task.due_time ?? '09:00').slice(0, 5)}:00+07:00`);
    const nextDueAt = Date.parse(`${nextDue}T${String(task.due_time ?? '09:00').slice(0, 5)}:00+07:00`);
    const leadTime = sourceDue - Date.parse(sourceReminder.remind_at);
    await supabase.from('task_reminders').insert({
      task_id: nextTask.id,
      owner_id: actorId,
      remind_at: new Date(nextDueAt - leadTime).toISOString(),
      preset: sourceReminder.preset,
      status: 'pending',
    });
  }
}

async function loadTaskOr404(c: Context<AppEnv>, id: string) {
  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('personal_tasks').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data;
}

async function cancelActiveTaskReminder(c: Context<AppEnv>, taskId: string): Promise<void> {
  await c.get('supabase')
    .from('task_reminders')
    .update({ status: 'cancelled', snoozed_until: null })
    .eq('task_id', taskId)
    .in('status', ['pending', 'snoozed']);
}

async function shiftTaskReminderWithDueDate(
  c: Context<AppEnv>,
  taskId: string,
  previousDate: string | null,
  previousTime: string | null,
  nextDate: string | null,
  nextTime: string | null,
): Promise<void> {
  if (previousDate === nextDate && previousTime === nextTime) return;
  const supabase = c.get('supabase');
  const { data: reminder } = await supabase
    .from('task_reminders')
    .select('id,remind_at,preset,status')
    .eq('task_id', taskId)
    .maybeSingle();
  if (!reminder || reminder.preset === 'custom' || reminder.status === 'cancelled') return;
  if (!nextDate) {
    await cancelActiveTaskReminder(c, taskId);
    return;
  }
  if (!previousDate) return;
  const previousDue = Date.parse(`${previousDate}T${String(previousTime ?? '09:00').slice(0, 5)}:00+07:00`);
  const nextDue = Date.parse(`${nextDate}T${String(nextTime ?? '09:00').slice(0, 5)}:00+07:00`);
  await supabase.from('task_reminders').update({
    remind_at: new Date(Date.parse(reminder.remind_at) + (nextDue - previousDue)).toISOString(),
  }).eq('id', reminder.id);
}

async function recalculateChecklistProgress(c: Context<AppEnv>, taskId: string): Promise<void> {
  const supabase = c.get('supabase');
  const actorId = c.get('userId');
  const [{ data: items, error: itemsError }, task] = await Promise.all([
    supabase.from('task_subtasks').select('status').eq('task_id', taskId).neq('status', 'ยกเลิก'),
    loadTaskOr404(c, taskId),
  ]);
  if (itemsError || !task) throw itemsError ?? new Error('Task not found while recalculating checklist progress');

  const progress = calculateChecklistProgress((items ?? []).map((item) => String(item.status)));
  if (progress === null) return;

  const patch: Record<string, unknown> = { progress, updated_by: actorId };
  if (progress === 100 && task.status !== 'เสร็จแล้ว' && task.status !== 'ยกเลิก') {
    patch.progress_before_complete = Math.min(Number(task.progress) || 0, 99);
    patch.status = 'เสร็จแล้ว';
    patch.completed_at = new Date().toISOString();
  } else if (progress < 100 && task.status === 'เสร็จแล้ว') {
    patch.status = 'กำลังทำ';
    patch.completed_at = null;
  } else if (progress > 0 && task.status === 'ต้องทำ') {
    patch.status = 'กำลังทำ';
  }

  const { data: updated, error } = await supabase.from('personal_tasks').update(patch).eq('id', taskId).select().single();
  if (error) throw error;
  if (progress === 100) {
    await createNextRecurringTask(c, updated);
    await cancelActiveTaskReminder(c, taskId);
  }
}

tasksRoute.get('/', zValidator('query', listTasksQuerySchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { status, priority, taskType, category, search, dueFrom, dueTo } = c.req.valid('query');

  // RLS (personal_tasks_all_own) เป็นตัวกรองสิทธิ์การมองเห็นจริง — เห็นเฉพาะของตนเองเสมอ
  let query = supabase.from('personal_tasks').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (priority) query = query.eq('priority', priority);
  if (taskType) query = query.eq('task_type', taskType);
  if (category) query = query.eq('category', category);
  if (dueFrom) query = query.gte('due_date', dueFrom);
  if (dueTo) query = query.lte('due_date', dueTo);
  if (search) {
    // PostgREST's `or` expression uses commas/parentheses as syntax. Remove only
    // those control characters while retaining Thai and normal punctuation.
    const term = search.replace(/[,%()]/g, ' ').trim();
    if (term) {
      query = query.or(
        `task_no.ilike.%${term}%,title.ilike.%${term}%,description.ilike.%${term}%,category.ilike.%${term}%,tags.ilike.%${term}%`,
      );
    }
  }

  const { data: tasks, error } = await query;
  if (error) {
    return c.json(fail(reqId, 'TASKS_LIST_FAILED', 'ดึงรายการงานไม่สำเร็จ'), 400);
  }

  const ids = (tasks ?? []).map((t) => t.id as string);
  const [{ data: subtasks }, { data: links }, { data: logs }, { data: reminders }] = ids.length
    ? await Promise.all([
        supabase.from('task_subtasks').select('*').in('task_id', ids).order('sort_order', { ascending: true }),
        supabase.from('task_links').select('*').in('task_id', ids).order('created_at', { ascending: true }),
        supabase.from('task_progress_logs').select('*').in('task_id', ids).order('logged_at', { ascending: false }),
        supabase.from('task_reminders').select('*').in('task_id', ids),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const byTask: Record<string, { subtasks: unknown[]; links: unknown[]; progressLogs: unknown[]; reminders: unknown[] }> = {};
  for (const id of ids) byTask[id] = { subtasks: [], links: [], progressLogs: [], reminders: [] };
  for (const row of subtasks ?? []) byTask[row.task_id as string]?.subtasks.push(row);
  for (const row of links ?? []) byTask[row.task_id as string]?.links.push(row);
  for (const row of logs ?? []) byTask[row.task_id as string]?.progressLogs.push(row);
  for (const row of reminders ?? []) byTask[row.task_id as string]?.reminders.push(row);

  const enriched = sortTasks((tasks ?? []) as TaskRow[]).map((t) => ({
    ...t,
    due_days: daysUntil(t.due_date),
    ...byTask[t.id],
  }));

  return c.json(ok(reqId, enriched));
});

tasksRoute.get('/dashboard', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const { data, error } = await supabase
    .from('personal_tasks')
    .select('id,task_no,task_type,title,description,category,priority,status,start_date,start_time,due_date,due_time,completed_at,progress,progress_before_complete,tags,notes,sort_order,recurrence,recurrence_rule,recurrence_end_date,recurring_parent_id,owner_id,created_at,updated_at');

  if (error) {
    return c.json(fail(reqId, 'TASK_DASHBOARD_FAILED', 'โหลดภาพรวมงานไม่สำเร็จ'), 400);
  }

  const dashboard = buildTaskDashboard((data ?? []) as TaskRow[]);
  const ids = [...dashboard.todayItems, ...dashboard.upcoming].map((task) => task.id);
  const { data: reminders } = ids.length
    ? await supabase.from('task_reminders').select('*').in('task_id', ids)
    : { data: [] };
  const remindersByTask = new Map<string, unknown[]>();
  for (const reminder of reminders ?? []) {
    const taskId = reminder.task_id as string;
    remindersByTask.set(taskId, [...(remindersByTask.get(taskId) ?? []), reminder]);
  }
  return c.json(ok(reqId, {
    ...dashboard,
    todayItems: dashboard.todayItems.map((task) => ({ ...task, due_days: daysUntil(task.due_date), subtasks: [], links: [], progressLogs: [], reminders: remindersByTask.get(task.id) ?? [] })),
    upcoming: dashboard.upcoming.map((task) => ({ ...task, due_days: daysUntil(task.due_date), subtasks: [], links: [], progressLogs: [], reminders: remindersByTask.get(task.id) ?? [] })),
  }));
});

tasksRoute.get('/:id', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const id = c.req.param('id')!;

  const task = await loadTaskOr404(c, id);
  if (!task) {
    return c.json(fail(reqId, 'TASK_NOT_FOUND', 'ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const [{ data: subtasks }, { data: links }, { data: logs }, { data: reminders }] = await Promise.all([
    supabase.from('task_subtasks').select('*').eq('task_id', id).order('sort_order', { ascending: true }),
    supabase.from('task_links').select('*').eq('task_id', id).order('created_at', { ascending: true }),
    supabase.from('task_progress_logs').select('*').eq('task_id', id).order('logged_at', { ascending: false }),
    supabase.from('task_reminders').select('*').eq('task_id', id),
  ]);

  return c.json(
    ok(reqId, {
      ...task,
      due_days: daysUntil(task.due_date),
      subtasks: subtasks ?? [],
      links: links ?? [],
      progressLogs: logs ?? [],
      reminders: reminders ?? [],
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
  const recurrence = body.recurrence ?? 'ไม่ทำซ้ำ';
  const recurrenceRule = resolveRecurrenceRule(recurrence, body.recurrenceRule, body.dueDate || null);
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
      task_type: body.taskType ?? 'general',
      category: body.category ?? 'งานทั่วไป',
      priority: body.priority ?? 'ปกติ',
      status,
      start_date: body.startDate || null,
      start_time: body.startTime || null,
      due_date: body.dueDate || null,
      due_time: body.dueTime || null,
      completed_at: completedAt,
      progress,
      tags: body.tags ?? null,
      notes: body.notes ?? null,
      sort_order: Date.now(),
      recurrence,
      recurrence_rule: recurrenceRule,
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
  let progressBeforeComplete = (current.progress_before_complete as number | null) ?? null;
  const recurrence = body.recurrence ?? String(current.recurrence ?? 'ไม่ทำซ้ำ');
  const recurrenceRule = resolveRecurrenceRule(
    recurrence,
    body.recurrenceRule ?? (current.recurrence_rule as TaskRecurrenceRule | null),
    body.dueDate || (current.due_date as string | null),
  );
  let completedAt: string | null = null;
  if (status === 'ยกเลิก') {
    completedAt = null;
  } else if (current.status === 'เสร็จแล้ว' && body.status && body.status !== 'เสร็จแล้ว') {
    progress = progress >= 100 ? (progressBeforeComplete ?? 0) : progress;
  } else if (status === 'เสร็จแล้ว' || progress === 100) {
    if (current.status !== 'เสร็จแล้ว') progressBeforeComplete = Math.min(Number(current.progress) || 0, 99);
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
      task_type: body.taskType ?? String(current.task_type ?? 'general'),
      category: body.category ?? 'งานทั่วไป',
      priority: body.priority ?? 'ปกติ',
      status,
      start_date: body.startDate || null,
      start_time: body.startTime || null,
      due_date: body.dueDate || null,
      due_time: body.dueTime || null,
      completed_at: completedAt,
      progress,
      progress_before_complete: progressBeforeComplete,
      tags: body.tags ?? null,
      notes: body.notes ?? null,
      recurrence,
      recurrence_rule: recurrenceRule,
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
  if (TERMINAL_STATUSES.has(status)) await cancelActiveTaskReminder(c, id);
  else await shiftTaskReminderWithDueDate(
    c,
    id,
    (current.due_date as string | null) ?? null,
    (current.due_time as string | null) ?? null,
    (updated.due_date as string | null) ?? null,
    (updated.due_time as string | null) ?? null,
  );

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

/** Soft delete for Phase 1. Permanent deletion remains reserved for Archive. */
tasksRoute.delete('/:id', async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const current = await loadTaskOr404(c, id);

  if (!current) {
    return c.json(fail(reqId, 'TASK_NOT_FOUND', 'ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const supabase = c.get('supabase');
  const { data: updated, error } = await supabase
    .from('personal_tasks')
    .update({
      status: 'ยกเลิก',
      completed_at: null,
      progress: current.status === 'เสร็จแล้ว' ? ((current.progress_before_complete as number | null) ?? 0) : current.progress,
      updated_by: actorId,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return c.json(fail(reqId, 'TASK_DELETE_FAILED', 'ไม่สามารถลบงานได้ กรุณาลองใหม่อีกครั้ง'), 400);
  }

  await cancelActiveTaskReminder(c, id);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'DELETE',
    module: 'task',
    targetTable: 'personal_tasks',
    targetId: id,
    detail: { mode: 'soft_delete', previousStatus: current.status },
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
    if (current.status !== 'เสร็จแล้ว') patch.progress_before_complete = Math.min(currentProgress, 99);
    patch.progress = 100;
    patch.completed_at = current.completed_at ?? new Date().toISOString();
  } else if (status === 'กำลังทำ') {
    const restored = current.status === 'เสร็จแล้ว' ? Number(current.progress_before_complete) : currentProgress;
    patch.progress = restored > 0 && restored < 100 ? restored : 10;
    patch.completed_at = null;
  } else if (status === 'ต้องทำ') {
    const restored = current.status === 'เสร็จแล้ว' ? Number(current.progress_before_complete) : currentProgress;
    patch.progress = Number.isFinite(restored) ? Math.min(restored, 99) : 0;
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
  if (TERMINAL_STATUSES.has(status)) await cancelActiveTaskReminder(c, id);

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

tasksRoute.post('/:id/priority', zValidator('json', setTaskPrioritySchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { priority } = c.req.valid('json');
  const current = await loadTaskOr404(c, id);

  if (!current) {
    return c.json(fail(reqId, 'TASK_NOT_FOUND', 'ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  }

  const supabase = c.get('supabase');
  const { data: updated, error } = await supabase
    .from('personal_tasks')
    .update({ priority, updated_by: actorId })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return c.json(fail(reqId, 'TASK_PRIORITY_UPDATE_FAILED', 'ไม่สามารถเปลี่ยนความสำคัญได้ กรุณาลองใหม่อีกครั้ง'), 400);
  }

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'UPDATE_PRIORITY',
    module: 'task',
    targetTable: 'personal_tasks',
    targetId: id,
    detail: { from: current.priority, to: priority },
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
  const restoredProgress = current.status === 'เสร็จแล้ว'
    ? (Number(current.progress_before_complete) || (status === 'กำลังทำ' ? 10 : 0))
    : currentProgress;
  const patch = {
    status,
    sort_order: sortOrder,
    progress: status === 'เสร็จแล้ว' ? 100 : Math.min(restoredProgress, 99),
    progress_before_complete: status === 'เสร็จแล้ว' && current.status !== 'เสร็จแล้ว'
      ? Math.min(currentProgress, 99)
      : current.progress_before_complete,
    completed_at: status === 'เสร็จแล้ว' ? (current.completed_at ?? new Date().toISOString()) : null,
    updated_by: actorId,
  };

  const supabase = c.get('supabase');
  const { data: updated, error } = await supabase.from('personal_tasks').update(patch).eq('id', id).select().single();
  if (error) {
    return c.json(fail(reqId, 'TASK_BOARD_UPDATE_FAILED', error.message), 400);
  }

  if (status === 'เสร็จแล้ว') await createNextRecurringTask(c, updated);
  if (TERMINAL_STATUSES.has(status)) await cancelActiveTaskReminder(c, id);

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

  await shiftTaskReminderWithDueDate(
    c,
    id,
    (current.due_date as string | null) ?? null,
    (current.due_time as string | null) ?? null,
    (updated.due_date as string | null) ?? null,
    (updated.due_time as string | null) ?? null,
  );

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

tasksRoute.put('/:id/reminder', zValidator('json', setTaskReminderSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const body = c.req.valid('json');
  const task = await loadTaskOr404(c, id);
  if (!task) return c.json(fail(reqId, 'TASK_NOT_FOUND', 'ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  if (TERMINAL_STATUSES.has(String(task.status))) {
    return c.json(fail(reqId, 'TASK_REMINDER_TERMINAL', 'ไม่สามารถตั้งเตือนให้งานที่เสร็จหรือยกเลิกแล้ว'), 400);
  }

  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('task_reminders').upsert({
    task_id: id,
    owner_id: actorId,
    remind_at: body.remindAt,
    preset: body.preset,
    status: 'pending',
    snoozed_until: null,
    sent_at: null,
  }, { onConflict: 'task_id' }).select().single();
  if (error) return c.json(fail(reqId, 'TASK_REMINDER_SAVE_FAILED', 'ไม่สามารถบันทึกการแจ้งเตือนได้ กรุณาลองใหม่อีกครั้ง'), 400);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'SET_REMINDER',
    module: 'task',
    targetTable: 'task_reminders',
    targetId: data.id,
    detail: { taskId: id, remindAt: body.remindAt, preset: body.preset },
    requestId: reqId,
  });
  return c.json(ok(reqId, data));
});

tasksRoute.delete('/:id/reminder', async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const task = await loadTaskOr404(c, id);
  if (!task) return c.json(fail(reqId, 'TASK_NOT_FOUND', 'ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  const { data, error } = await c.get('supabase').from('task_reminders')
    .update({ status: 'cancelled', snoozed_until: null })
    .eq('task_id', id)
    .select()
    .maybeSingle();
  if (error) return c.json(fail(reqId, 'TASK_REMINDER_CANCEL_FAILED', 'ยกเลิกการแจ้งเตือนไม่สำเร็จ'), 400);
  if (data) await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'CANCEL_REMINDER',
    module: 'task',
    targetTable: 'task_reminders',
    targetId: data.id,
    detail: { taskId: id },
    requestId: reqId,
  });
  return c.json(ok(reqId, data));
});

tasksRoute.post('/:id/reminder/snooze', zValidator('json', snoozeTaskReminderSchema, zodValidationHook), async (c) => {
  const reqId = c.get('requestId');
  const actorId = c.get('userId');
  const id = c.req.param('id')!;
  const { minutes } = c.req.valid('json');
  const task = await loadTaskOr404(c, id);
  if (!task) return c.json(fail(reqId, 'TASK_NOT_FOUND', 'ไม่พบงานนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  if (TERMINAL_STATUSES.has(String(task.status))) return c.json(fail(reqId, 'TASK_REMINDER_TERMINAL', 'ไม่สามารถ Snooze งานที่ปิดแล้ว'), 400);

  const snoozedUntil = new Date(Date.now() + (minutes * 60_000)).toISOString();
  const { data, error } = await c.get('supabase').from('task_reminders')
    .update({ status: 'snoozed', snoozed_until: snoozedUntil, sent_at: null })
    .eq('task_id', id)
    .neq('status', 'cancelled')
    .select()
    .maybeSingle();
  if (error) return c.json(fail(reqId, 'TASK_REMINDER_SNOOZE_FAILED', 'Snooze การแจ้งเตือนไม่สำเร็จ'), 400);
  if (!data) return c.json(fail(reqId, 'TASK_REMINDER_NOT_FOUND', 'งานนี้ยังไม่ได้ตั้งการแจ้งเตือน'), 404);

  await writeAuditLog(c.env, {
    actorId,
    actorEmail: c.get('userEmail'),
    action: 'SNOOZE_REMINDER',
    module: 'task',
    targetTable: 'task_reminders',
    targetId: data.id,
    detail: { taskId: id, minutes, snoozedUntil },
    requestId: reqId,
  });
  return c.json(ok(reqId, data));
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
  const { data: updated, error: updateError } = await supabase.from('personal_tasks').update(patch).eq('id', id).select().single();
  if (updateError) {
    return c.json(fail(reqId, 'TASK_PROGRESS_LOG_FAILED', updateError.message), 400);
  }
  if (progress === 100) {
    await createNextRecurringTask(c, updated);
    await cancelActiveTaskReminder(c, id);
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

  await recalculateChecklistProgress(c, id);

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

  await recalculateChecklistProgress(c, String(updated.task_id));

  return c.json(ok(reqId, updated));
});

tasksRoute.patch('/subtasks/:subtaskId/detail', zValidator('json', updateTaskSubtaskSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const subtaskId = c.req.param('subtaskId')!;
  const body = c.req.valid('json');
  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.dueDate !== undefined) patch.due_date = body.dueDate || null;
  if (body.notes !== undefined) patch.notes = body.notes || null;

  const { data: updated, error } = await supabase.from('task_subtasks').update(patch).eq('id', subtaskId).select().maybeSingle();
  if (error) return c.json(fail(reqId, 'TASK_SUBTASK_UPDATE_FAILED', error.message), 400);
  if (!updated) return c.json(fail(reqId, 'TASK_SUBTASK_NOT_FOUND', 'ไม่พบรายการย่อยนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  return c.json(ok(reqId, updated));
});

tasksRoute.post('/subtasks/:subtaskId/reorder', zValidator('json', reorderTaskSubtaskSchema, zodValidationHook), async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const subtaskId = c.req.param('subtaskId')!;
  const { sortOrder } = c.req.valid('json');
  const { data: updated, error } = await supabase
    .from('task_subtasks')
    .update({ sort_order: sortOrder })
    .eq('id', subtaskId)
    .select()
    .maybeSingle();
  if (error) return c.json(fail(reqId, 'TASK_SUBTASK_REORDER_FAILED', error.message), 400);
  if (!updated) return c.json(fail(reqId, 'TASK_SUBTASK_NOT_FOUND', 'ไม่พบรายการย่อยนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  return c.json(ok(reqId, updated));
});

tasksRoute.delete('/subtasks/:subtaskId', async (c) => {
  const supabase = c.get('supabase');
  const reqId = c.get('requestId');
  const subtaskId = c.req.param('subtaskId')!;
  const { data: deleted, error } = await supabase.from('task_subtasks').delete().eq('id', subtaskId).select().maybeSingle();
  if (error) return c.json(fail(reqId, 'TASK_SUBTASK_DELETE_FAILED', error.message), 400);
  if (!deleted) return c.json(fail(reqId, 'TASK_SUBTASK_NOT_FOUND', 'ไม่พบรายการย่อยนี้ หรือท่านไม่มีสิทธิ์เข้าถึง'), 404);
  await recalculateChecklistProgress(c, String(deleted.task_id));
  return c.json(ok(reqId, { id: subtaskId }));
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

  await recalculateChecklistProgress(c, String(updated.task_id));

  return c.json(ok(reqId, updated));
});
