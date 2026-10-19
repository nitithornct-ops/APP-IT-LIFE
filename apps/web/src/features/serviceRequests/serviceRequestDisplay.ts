import type { ServiceRequestPriority, ServiceRequestStatus } from '../../types/serviceRequests';

type RequestTone = 'secondary' | 'info' | 'warning' | 'success' | 'danger' | 'primary';

export const requestStatusTone: Record<ServiceRequestStatus, RequestTone> = {
  รออนุมัติ: 'warning',
  รอมอบหมาย: 'info',
  กำลังดำเนินการ: 'primary',
  รอผู้ใช้งาน: 'warning',
  รอผู้ให้บริการ: 'warning',
  รอยืนยันผล: 'warning',
  ปิดงาน: 'success',
  ปฏิเสธ: 'danger',
  ยกเลิก: 'secondary',
};

export const requestPriorityTone: Record<ServiceRequestPriority, RequestTone> = {
  ต่ำ: 'secondary',
  ปานกลาง: 'info',
  สูง: 'warning',
  วิกฤต: 'danger',
};
