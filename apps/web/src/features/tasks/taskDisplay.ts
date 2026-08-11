import type { TaskCategory, TaskPriority, TaskRecurrence, TaskStatus, TaskType } from '../../types/tasks';

export const TASK_STATUSES: TaskStatus[] = ['ต้องทำ', 'กำลังทำ', 'รอข้อมูล', 'รอผู้อื่นดำเนินการ', 'พักไว้ก่อน', 'เสร็จแล้ว', 'ยกเลิก'];
export const TASK_PRIORITIES: TaskPriority[] = ['ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน'];
export const TASK_CATEGORIES: TaskCategory[] = ['งานทั่วไป', 'ประชุม', 'ติดตาม', 'เอกสาร', 'โครงการ', 'พัฒนาระบบ', 'ส่วนตัว', 'อื่นๆ'];
export const TASK_RECURRENCES: TaskRecurrence[] = ['ไม่ทำซ้ำ', 'รายวัน', 'วันทำงาน', 'รายสัปดาห์', 'ทุก 2 สัปดาห์', 'รายเดือน', 'รายไตรมาส', 'ทุก 6 เดือน', 'รายปี', 'กำหนดเอง'];
export const TASK_TYPES: { value: TaskType; label: string }[] = [
  { value: 'general', label: 'งานทั่วไป' },
  { value: 'meeting', label: 'ประชุม' },
  { value: 'follow_up', label: 'ติดตามงาน' },
  { value: 'document', label: 'งานเอกสาร' },
  { value: 'project', label: 'โครงการ' },
  { value: 'system_development', label: 'พัฒนาระบบ' },
  { value: 'personal', label: 'ส่วนตัว' },
  { value: 'other', label: 'อื่น ๆ' },
];

export const taskTypeLabel = Object.fromEntries(TASK_TYPES.map((item) => [item.value, item.label])) as Record<TaskType, string>;

export const statusTone: Record<TaskStatus, 'secondary' | 'info' | 'warning' | 'success' | 'danger' | 'primary'> = {
  ต้องทำ: 'secondary',
  กำลังทำ: 'primary',
  รอข้อมูล: 'warning',
  รอผู้อื่นดำเนินการ: 'warning',
  พักไว้ก่อน: 'info',
  เสร็จแล้ว: 'success',
  ยกเลิก: 'danger',
};

export const priorityTone: Record<TaskPriority, 'secondary' | 'info' | 'warning' | 'danger'> = {
  ต่ำ: 'secondary',
  ปกติ: 'info',
  สูง: 'warning',
  เร่งด่วน: 'danger',
};
