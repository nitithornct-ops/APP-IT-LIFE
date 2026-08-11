import { describe, expect, it } from 'vitest';
import { createTaskSchema, listTasksQuerySchema, reorderTaskSubtaskSchema, setTaskDueDateSchema, setTaskPrioritySchema, setTaskReminderSchema, snoozeTaskReminderSchema, updateTaskSubtaskSchema } from '../src/validators/tasks';

describe('Task core validators', () => {
  it('accepts the Phase 1 defaults and task type', () => {
    expect(createTaskSchema.safeParse({ title: 'จัดทำ TOR ระบบ HR', taskType: 'document', priority: 'สูง', dueTime: '13:30' }).success).toBe(true);
  });

  it('rejects an unknown task type and an inverted date range', () => {
    expect(createTaskSchema.safeParse({ title: 'งานใหม่', taskType: 'unknown' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'งานใหม่', dueTime: '25:99' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'งานใหม่', startDate: '2026-08-12', dueDate: '2026-08-11' }).success).toBe(false);
  });

  it('validates server-side search, priority, type and due date filters', () => {
    expect(listTasksQuerySchema.safeParse({ search: 'TOR', priority: 'เร่งด่วน', taskType: 'document', dueFrom: '2026-08-01', dueTo: '2026-08-31' }).success).toBe(true);
    expect(listTasksQuerySchema.safeParse({ priority: 'วิกฤต' }).success).toBe(false);
    expect(listTasksQuerySchema.safeParse({ dueFrom: '11/08/2569' }).success).toBe(false);
  });

  it('accepts clearing or changing a due date', () => {
    expect(setTaskDueDateSchema.safeParse({ dueDate: '' }).success).toBe(true);
    expect(setTaskDueDateSchema.safeParse({ dueDate: '2026-08-11' }).success).toBe(true);
  });

  it('accepts only supported priority values for inline Today actions', () => {
    expect(setTaskPrioritySchema.safeParse({ priority: 'เร่งด่วน' }).success).toBe(true);
    expect(setTaskPrioritySchema.safeParse({ priority: 'วิกฤต' }).success).toBe(false);
  });

  it('validates checklist edits and ordering', () => {
    expect(updateTaskSubtaskSchema.safeParse({ title: 'ตรวจสอบงบประมาณ' }).success).toBe(true);
    expect(updateTaskSubtaskSchema.safeParse({}).success).toBe(false);
    expect(reorderTaskSubtaskSchema.safeParse({ sortOrder: 2 }).success).toBe(true);
    expect(reorderTaskSubtaskSchema.safeParse({ sortOrder: -1 }).success).toBe(false);
  });

  it('validates recurring presets and custom rules', () => {
    expect(createTaskSchema.safeParse({ title: 'ตรวจ Backup', dueDate: '2026-08-11', recurrence: 'วันทำงาน' }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: 'ตรวจ License', dueDate: '2026-08-15', recurrence: 'กำหนดเอง', recurrenceRule: { frequency: 'monthly', interval: 2 } }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: 'ข้อมูลไม่ครบ', recurrence: 'รายวัน' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'ข้อมูลไม่ครบ', dueDate: '2026-08-11', recurrence: 'กำหนดเอง' }).success).toBe(false);
  });

  it('validates reminder timestamps, presets and snooze durations', () => {
    expect(setTaskReminderSchema.safeParse({ remindAt: '2026-08-11T09:00:00+07:00', preset: 'before_30m' }).success).toBe(true);
    expect(setTaskReminderSchema.safeParse({ remindAt: '11/08/2569 09:00', preset: 'custom' }).success).toBe(false);
    expect(snoozeTaskReminderSchema.safeParse({ minutes: 30 }).success).toBe(true);
    expect(snoozeTaskReminderSchema.safeParse({ minutes: 17 }).success).toBe(false);
  });
});
