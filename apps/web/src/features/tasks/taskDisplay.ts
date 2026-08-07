import type { TaskCategory, TaskPriority, TaskRecurrence, TaskStatus } from '../../types/tasks';

export const TASK_STATUSES: TaskStatus[] = ['ต้องทำ', 'กำลังทำ', 'รอข้อมูล', 'รอผู้อื่นดำเนินการ', 'พักไว้ก่อน', 'เสร็จแล้ว', 'ยกเลิก'];
export const TASK_PRIORITIES: TaskPriority[] = ['ต่ำ', 'ปกติ', 'สูง', 'เร่งด่วน'];
export const TASK_CATEGORIES: TaskCategory[] = ['งานทั่วไป', 'ประชุม', 'ติดตาม', 'เอกสาร', 'โครงการ', 'พัฒนาระบบ', 'ส่วนตัว', 'อื่นๆ'];
export const TASK_RECURRENCES: TaskRecurrence[] = ['ไม่ทำซ้ำ', 'รายวัน', 'รายสัปดาห์', 'รายเดือน', 'รายไตรมาส', 'รายปี'];

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
