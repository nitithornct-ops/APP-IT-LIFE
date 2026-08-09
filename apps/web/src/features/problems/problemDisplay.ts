import type { KnownError, Problem } from '../../types/problems';

export const problemStatusTone: Record<Problem['status'], 'info' | 'warning' | 'success'> = {
  เปิด: 'info',
  กำลังวิเคราะห์: 'warning',
  กำลังแก้ไข: 'warning',
  รอตรวจยืนยัน: 'warning',
  ปิด: 'success',
};

export const priorityTone: Record<Problem['priority'], 'secondary' | 'warning' | 'danger'> = {
  ต่ำ: 'secondary',
  ปานกลาง: 'warning',
  สูง: 'danger',
  วิกฤต: 'danger',
};

export const knownErrorStatusTone: Record<KnownError['status'], 'secondary' | 'info' | 'success' | 'danger'> = {
  ร่าง: 'secondary',
  เผยแพร่: 'info',
  แก้ไขแล้ว: 'success',
  ยกเลิก: 'danger',
};
