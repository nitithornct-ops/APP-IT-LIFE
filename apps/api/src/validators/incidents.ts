import { listQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const INCIDENT_CATEGORIES = [
  'มัลแวร์/ไวรัส',
  'การเข้าถึงโดยไม่ได้รับอนุญาต',
  'ข้อมูลรั่วไหล',
  'ฟิชชิง/หลอกลวง',
  'ระบบล่ม/ใช้งานไม่ได้',
  'การละเมิดนโยบาย',
  'อื่นๆ',
] as const;
export const INCIDENT_SEVERITIES = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'] as const;
export const INCIDENT_STATUSES = ['เปิด', 'กำลังดำเนินการ', 'ปิดเคส'] as const;
export const INCIDENT_ACTIVE_STATUSES = ['เปิด', 'กำลังดำเนินการ'] as const;
export const BREACH_RISK_LEVELS = ['ไม่มีความเสี่ยง', 'ต่ำ', 'ปานกลาง', 'สูง'] as const;
export const REGULATORY_DECISIONS = ['Yes', 'No', 'Pending'] as const;
export const REGULATORY_DESTINATIONS = ['PDPC', 'DATA_SUBJECT', 'NCSA', 'OTHER'] as const;
export const REGULATORY_NOTIFICATION_STATUSES = ['รอแจ้ง', 'แจ้งแล้ว', 'ไม่ต้องแจ้ง', 'ยกเลิก'] as const;

const optionalUrl = z.union([z.string().trim().url('URL ไม่ถูกต้อง').max(1000), z.literal('')]).optional();
const optionalDateTime = z.union([z.string().datetime({ offset: true }), z.literal('')]).optional();

export const listIncidentsQuerySchema = listQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  category: z.enum(INCIDENT_CATEGORIES).optional(),
  personalData: z.enum(['true', 'false']).optional(),
  riskLevel: z.enum(['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต']).optional(),
  mine: z.enum(['true', 'false']).optional(),
});
export const createIncidentSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกหัวข้อ').max(200),
  description: z.string().trim().min(1, 'กรุณากรอกรายละเอียด').max(3000),
  category: z.enum(INCIDENT_CATEGORIES),
  affectedSystem: z.string().trim().max(150).optional(),
  containsPersonalData: z.boolean().optional(),
  evidenceUrl: optionalUrl,
});

export const updateIncidentSchema = z.object({
  severity: z.enum(INCIDENT_SEVERITIES).nullable().optional(),
  likelihood: z.number().int().min(1).max(5).nullable().optional(),
  impact: z.number().int().min(1).max(5).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  status: z.enum(INCIDENT_ACTIVE_STATUSES).optional(),
  notes: z.string().trim().max(2000).optional(),
  evidenceUrl: optionalUrl,
});

export const markDpoNotifiedSchema = z.object({
  note: z.string().trim().min(1, 'กรุณาระบุรายละเอียดการแจ้ง DPO').max(300),
});

export const regulatoryAssessmentSchema = z.object({
  breachRiskLevel: z.enum(BREACH_RISK_LEVELS).optional(),
  pdpcRequired: z.enum(REGULATORY_DECISIONS),
  dataSubjectRequired: z.enum(REGULATORY_DECISIONS),
  ncsaRequired: z.enum(REGULATORY_DECISIONS),
  otherRegulatorRequired: z.enum(REGULATORY_DECISIONS),
  assessment: z.string().trim().min(1, 'กรุณาระบุเหตุผลการประเมิน').max(3000),
});

export const createRegulatoryNotificationSchema = z
  .object({
    destination: z.enum(REGULATORY_DESTINATIONS),
    agency: z.string().trim().min(1, 'กรุณาระบุหน่วยงาน/ผู้รับแจ้ง').max(250),
    notificationType: z.string().trim().min(1, 'กรุณาระบุประเภทการแจ้ง').max(250),
    required: z.boolean(),
    legalBasis: z.string().trim().max(1000).optional(),
    deadline: optionalDateTime,
    status: z.enum(REGULATORY_NOTIFICATION_STATUSES),
    notifiedAt: optionalDateTime,
    referenceNo: z.string().trim().max(250).optional(),
    evidenceUrl: optionalUrl,
    reasonNotRequired: z.string().trim().max(2000).optional(),
    notes: z.string().trim().max(1500).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.required && !data.reasonNotRequired) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reasonNotRequired'], message: 'กรุณาระบุเหตุผลว่าไม่ต้องแจ้ง' });
    }
    if (!data.required && data.status !== 'ไม่ต้องแจ้ง') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'กรณีไม่ต้องแจ้ง ต้องเลือกสถานะ “ไม่ต้องแจ้ง”' });
    }
    if (data.required && data.status === 'ไม่ต้องแจ้ง') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'สถานะขัดกับการเลือกว่ามีหน้าที่ต้องแจ้ง' });
    }
    if (data.status === 'แจ้งแล้ว' && !data.referenceNo && !data.evidenceUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['referenceNo'], message: 'ต้องระบุเลขรับเรื่องหรือลิงก์หลักฐาน' });
    }
  });

export const closeIncidentSchema = z.object({
  rootCause: z.string().trim().min(1, 'กรุณาระบุ Root Cause').max(2000),
  resolution: z.string().trim().min(1, 'กรุณาระบุผลการแก้ไข').max(2000),
  lessonsLearned: z.string().trim().max(2000).optional(),
});

export const escalateTicketSchema = z.object({
  category: z.enum(INCIDENT_CATEGORIES),
  severity: z.enum(INCIDENT_SEVERITIES),
  containsPersonalData: z.boolean().optional(),
  notes: z.string().trim().max(1000).optional(),
});
