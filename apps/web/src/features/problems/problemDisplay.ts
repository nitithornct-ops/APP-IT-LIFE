import type { KnownError, Problem } from '../../types/problems';

export const problemStatusTone: Record<Problem['status'], 'info' | 'primary' | 'warning' | 'success'> = {
  เปิด: 'info',
  กำลังวิเคราะห์: 'primary',
  กำลังแก้ไข: 'primary',
  รอตรวจยืนยัน: 'warning',
  ปิด: 'success',
};

export const priorityTone: Record<Problem['priority'], 'secondary' | 'info' | 'warning' | 'danger'> = {
  ต่ำ: 'secondary',
  ปานกลาง: 'info',
  สูง: 'warning',
  วิกฤต: 'danger',
};

export const knownErrorStatusTone: Record<KnownError['status'], 'secondary' | 'info' | 'success' | 'danger'> = {
  ร่าง: 'secondary',
  เผยแพร่: 'info',
  แก้ไขแล้ว: 'success',
  ยกเลิก: 'secondary',
};
