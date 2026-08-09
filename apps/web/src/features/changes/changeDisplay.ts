import type { ChangeRequest } from '../../types/changes';

export const changeStatusTone: Record<ChangeRequest['status'], 'secondary' | 'info' | 'warning' | 'success' | 'danger'> = {
  ยื่นคำขอ: 'secondary',
  ผ่านการทดสอบ: 'info',
  อนุมัติแล้ว: 'warning',
  ติดตั้งใช้งานแล้ว: 'success',
  ปฏิเสธ: 'danger',
};

export const changeRiskTone: Record<ChangeRequest['risk_level'], 'danger' | 'warning' | 'secondary'> = {
  สูง: 'danger',
  กลาง: 'warning',
  ต่ำ: 'secondary',
};

export function profileName(profile: ChangeRequest['requester']): string {
  return profile?.full_name || profile?.email || '—';
}
