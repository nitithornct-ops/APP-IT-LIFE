export type TaskStatus = 'ต้องทำ' | 'กำลังทำ' | 'รอข้อมูล' | 'รอผู้อื่นดำเนินการ' | 'พักไว้ก่อน' | 'เสร็จแล้ว' | 'ยกเลิก';
export type TaskPriority = 'ต่ำ' | 'ปกติ' | 'สูง' | 'เร่งด่วน';
export type TaskCategory = 'งานทั่วไป' | 'ประชุม' | 'ติดตาม' | 'เอกสาร' | 'โครงการ' | 'พัฒนาระบบ' | 'ส่วนตัว' | 'อื่นๆ';
export type TaskRecurrence = 'ไม่ทำซ้ำ' | 'รายวัน' | 'รายสัปดาห์' | 'รายเดือน' | 'รายไตรมาส' | 'รายปี';

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

export interface Task {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  start_date: string | null;
  due_date: string | null;
  due_days: number | null;
  completed_at: string | null;
  progress: number;
  tags: string | null;
  notes: string | null;
  sort_order: number;
  recurrence: TaskRecurrence;
  recurrence_end_date: string | null;
  recurring_parent_id: string | null;
  created_at: string;
  updated_at: string;
  subtasks: TaskSubtask[];
  links: TaskLink[];
  progressLogs: TaskProgressLog[];
}
