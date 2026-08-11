export type TaskStatus = 'ต้องทำ' | 'กำลังทำ' | 'รอข้อมูล' | 'รอผู้อื่นดำเนินการ' | 'พักไว้ก่อน' | 'เสร็จแล้ว' | 'ยกเลิก';
export type TaskPriority = 'ต่ำ' | 'ปกติ' | 'สูง' | 'เร่งด่วน';
export type TaskType = 'general' | 'meeting' | 'follow_up' | 'document' | 'project' | 'system_development' | 'personal' | 'other';
export type TaskCategory = 'งานทั่วไป' | 'ประชุม' | 'ติดตาม' | 'เอกสาร' | 'โครงการ' | 'พัฒนาระบบ' | 'ส่วนตัว' | 'อื่นๆ';
export type TaskRecurrence = 'ไม่ทำซ้ำ' | 'รายวัน' | 'วันทำงาน' | 'รายสัปดาห์' | 'ทุก 2 สัปดาห์' | 'รายเดือน' | 'รายไตรมาส' | 'ทุก 6 เดือน' | 'รายปี' | 'กำหนดเอง';

export interface TaskRecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  weekdays?: number[];
  dayOfMonth?: number;
  monthOfYear?: number;
}

export interface TaskSubtask {
  id: string;
  task_id: string;
  title: string;
  status: 'ต้องทำ' | 'เสร็จแล้ว' | 'ยกเลิก';
  due_date: string | null;
  sort_order: number;
  completed_at: string | null;
  notes: string | null;
}

export interface TaskProgressLog {
  id: string;
  task_id: string;
  progress: number;
  progress_before_complete: number | null;
  note: string;
  logged_at: string;
}

export interface TaskLink {
  id: string;
  task_id: string;
  label: string;
  url: string;
  created_at: string;
}

export interface TaskReminder {
  id: string;
  task_id: string;
  remind_at: string;
  preset: 'at_time' | 'before_15m' | 'before_30m' | 'before_1h' | 'before_3h' | 'before_1d' | 'before_3d' | 'custom';
  status: 'pending' | 'snoozed' | 'sent' | 'cancelled';
  snoozed_until: string | null;
  sent_at: string | null;
}

export interface Task {
  id: string;
  task_no: string;
  task_type: TaskType;
  owner_id: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  start_date: string | null;
  start_time: string | null;
  due_date: string | null;
  due_time: string | null;
  due_days: number | null;
  completed_at: string | null;
  progress: number;
  tags: string | null;
  notes: string | null;
  sort_order: number;
  recurrence: TaskRecurrence;
  recurrence_rule: TaskRecurrenceRule | null;
  recurrence_end_date: string | null;
  recurring_parent_id: string | null;
  created_at: string;
  updated_at: string;
  subtasks: TaskSubtask[];
  links: TaskLink[];
  progressLogs: TaskProgressLog[];
  reminders: TaskReminder[];
}

export interface TaskDashboardSummary {
  open: number;
  today: number;
  dueSoon: number;
  overdue: number;
  completed: number;
  inProgress: number;
  averageProgress: number;
}

export interface TaskDashboard {
  generatedAt: string;
  timezone: 'Asia/Bangkok';
  summary: TaskDashboardSummary;
  todayItems: Task[];
  upcoming: Task[];
}
