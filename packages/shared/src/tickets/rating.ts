import { z } from 'zod';

export const TICKET_RATING_CRITERIA = [
  { key: 'responsiveness', label: 'ความรวดเร็ว' },
  { key: 'workQuality', label: 'คุณภาพงานซ่อม' },
  { key: 'serviceManners', label: 'การบริการและมารยาท' },
  { key: 'expertise', label: 'ความรู้ความสามารถ' },
  { key: 'communication', label: 'การสื่อสารและแจ้งความคืบหน้า' },
] as const;

export type TicketRatingKey = string;
export type TicketRatingDetails = Record<TicketRatingKey, number>;

export interface TicketRatingCriterion {
  id: string;
  key: string;
  label: string;
  description: string | null;
  sort_order: number;
  status: 'active' | 'inactive';
}

export interface TicketRatingSnapshotItem {
  key: string;
  label: string;
  score: number;
}

const score = z.coerce.number().int().min(1, 'คะแนนต้องอยู่ระหว่าง 1-5').max(5, 'คะแนนต้องอยู่ระหว่าง 1-5');

export const ticketRatingDetailsSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{2,63}$/), score)
  .refine((details) => Object.keys(details).length >= 1, 'กรุณาให้คะแนนอย่างน้อย 1 หัวข้อ')
  .refine((details) => Object.keys(details).length <= 20, 'หัวข้อประเมินต้องไม่เกิน 20 หัวข้อ');

export function calculateTicketOverallRating(details: TicketRatingDetails): number {
  const scores = Object.values(details);
  if (!scores.length) throw new Error('ต้องมีคะแนนอย่างน้อย 1 หัวข้อ');
  return Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
}
