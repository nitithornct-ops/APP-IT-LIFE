import { ticketStatusLabel } from '../tickets/ticketDisplay';
import type { LineNotification } from './types';

/** อักษรย่อสำหรับ avatar เมื่อไม่มีรูปโปรไฟล์จาก LINE */
export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((part) => part[0]).join('');
}

/**
 * ข้อความที่ผู้แจ้งควรเห็นในฟีดแจ้งเตือน — บันทึกของทีม IT อ่านเข้าใจกว่าชื่อ action ดิบ
 * จึงใช้ detail ก่อน แล้วค่อยตกไปที่สถานะปลายทางและชื่อ action ตามลำดับ
 */
export function notificationText(notification: LineNotification): string {
  const detail = notification.detail?.trim();
  if (detail) return detail;
  if (notification.status_to) return `อัปเดตสถานะเป็น “${ticketStatusLabel[notification.status_to]}”`;
  return notification.action;
}
