import { z } from 'zod';

export const BACKUP_TYPES = ['Full', 'Incremental', 'Differential', 'System Snapshot'] as const;
export const BACKUP_RESULTS = ['สำเร็จ', 'สำเร็จบางส่วน', 'ล้มเหลว'] as const;
export const RECOVERY_RESULTS = ['ผ่าน', 'ผ่านบางส่วน', 'ไม่ผ่าน'] as const;
export const BCP_STATUSES = ['ใช้งาน', 'ระงับ', 'ยกเลิก'] as const;
export const LOG_FREQUENCIES = ['รายวัน', 'รายสัปดาห์', 'รายเดือน', 'รายไตรมาส'] as const;
export const LOG_REVIEW_STATUSES = ['ปกติ', 'กำลังดำเนินการ', 'แก้ไขแล้ว', 'ยอมรับความเสี่ยง'] as const;

const optionalUuid = z.union([z.string().uuid(), z.literal('')]).optional();
const optionalDate = z.union([z.string().date(), z.literal('')]).optional();
const optionalHttps = z.union([
  z.string().trim().url('URL ไม่ถูกต้อง').max(500).refine((value) => value.startsWith('https://'), 'ต้องเป็น HTTPS'),
  z.literal(''),
]).optional();
const optionalText = (max: number) => z.string().trim().max(max).optional();
const nonEmptyPatch = <T extends z.ZodTypeAny>(schema: T) => schema.refine((value) => Object.keys(value as object).length > 0, 'ไม่มีข้อมูลที่ต้องแก้ไข');

const backupObject = z.object({
  systemName: z.string().trim().min(1).max(120),
  configurationItemId: optionalUuid,
  backupType: z.enum(BACKUP_TYPES),
  backupDate: z.string().date(),
  result: z.enum(BACKUP_RESULTS),
  dataSize: optionalText(80),
  storageLocation: optionalText(300),
  operatorId: optionalUuid,
  nextBackupDue: optionalDate,
  evidenceLink: optionalHttps,
  checksum: optionalText(128),
  rowCount: z.coerce.number().int().min(0).optional(),
  notes: optionalText(1000),
});
const refineBackupDates = (value: { backupDate?: string; nextBackupDue?: string }, ctx: z.RefinementCtx) => {
  if (value.backupDate && value.nextBackupDue && value.nextBackupDue < value.backupDate) ctx.addIssue({ code: 'custom', path: ['nextBackupDue'], message: 'กำหนดสำรองครั้งถัดไปต้องไม่ก่อนวันที่สำรอง' });
};
const backupBase = backupObject.superRefine(refineBackupDates);

const recoveryObject = z.object({
  backupLogId: optionalUuid,
  systemName: z.string().trim().min(1).max(120),
  configurationItemId: optionalUuid,
  testDate: z.string().date(),
  scenario: optionalText(1000),
  result: z.enum(RECOVERY_RESULTS),
  rtoActual: optionalText(80),
  rpoActual: optionalText(80),
  testerId: optionalUuid,
  nextTestDue: optionalDate,
  evidenceLink: optionalHttps,
  findings: optionalText(2000),
  notes: optionalText(1000),
});
const refineRecoveryDates = (value: { testDate?: string; nextTestDue?: string }, ctx: z.RefinementCtx) => {
  if (value.testDate && value.nextTestDue && value.nextTestDue < value.testDate) ctx.addIssue({ code: 'custom', path: ['nextTestDue'], message: 'กำหนดทดสอบครั้งถัดไปต้องไม่ก่อนวันที่ทดสอบ' });
};
const recoveryBase = recoveryObject.superRefine(refineRecoveryDates);

const bcpObject = z.object({
  planName: z.string().trim().min(1).max(200),
  scope: optionalText(1500),
  ownerId: optionalUuid,
  lastReviewDate: optionalDate,
  nextReviewDue: optionalDate,
  documentLink: optionalHttps,
  status: z.enum(BCP_STATUSES),
  notes: optionalText(1000),
});
const refineBcpDates = (value: { lastReviewDate?: string; nextReviewDue?: string }, ctx: z.RefinementCtx) => {
  if (value.lastReviewDate && value.nextReviewDue && value.nextReviewDue < value.lastReviewDate) ctx.addIssue({ code: 'custom', path: ['nextReviewDue'], message: 'รอบทบทวนถัดไปต้องไม่ก่อนวันที่ทบทวนล่าสุด' });
};
const bcpBase = bcpObject.superRefine(refineBcpDates);

const loggingSystemBase = z.object({
  systemName: z.string().trim().min(1).max(120),
  configurationItemId: optionalUuid,
  logType: optionalText(100),
  logLocation: optionalText(300),
  reviewFrequency: z.enum(LOG_FREQUENCIES),
  responsibleId: optionalUuid,
  retentionPeriod: optionalText(100),
  status: z.enum(['ใช้งาน', 'ระงับ']),
  notes: optionalText(1000),
});

const logReviewObject = z.object({
  loggingSystemId: z.string().uuid(),
  reviewDate: z.string().date(),
  reviewerId: optionalUuid,
  period: z.string().trim().min(1).max(100),
  anomalyFound: z.boolean(),
  anomalyDetail: optionalText(2000),
  actionTaken: optionalText(2000),
  status: z.enum(LOG_REVIEW_STATUSES),
  evidenceLink: optionalHttps,
  notes: optionalText(1000),
});
const refineLogReview = (value: { anomalyFound?: boolean; anomalyDetail?: string; status?: string }, ctx: z.RefinementCtx) => {
  if (value.anomalyFound && !value.anomalyDetail) ctx.addIssue({ code: 'custom', path: ['anomalyDetail'], message: 'กรุณาระบุรายละเอียด Anomaly' });
  if (value.anomalyFound === false && value.status && value.status !== 'ปกติ') ctx.addIssue({ code: 'custom', path: ['status'], message: 'เมื่อไม่พบ Anomaly สถานะต้องเป็นปกติ' });
  if (value.anomalyFound && value.status === 'ปกติ') ctx.addIssue({ code: 'custom', path: ['status'], message: 'เมื่อพบ Anomaly ต้องระบุสถานะการดำเนินการ' });
};
const logReviewBase = logReviewObject.superRefine(refineLogReview);

export const createBackupSchema = backupBase;
export const updateBackupSchema = nonEmptyPatch(backupObject.partial().superRefine(refineBackupDates));
export const createRecoverySchema = recoveryBase;
export const updateRecoverySchema = nonEmptyPatch(recoveryObject.partial().superRefine(refineRecoveryDates));
export const createBcpSchema = bcpBase;
export const updateBcpSchema = nonEmptyPatch(bcpObject.partial().superRefine(refineBcpDates));
export const invokeBcpSchema = z.object({ reason: z.string().trim().min(1).max(1000) });
export const createLoggingSystemSchema = loggingSystemBase;
export const updateLoggingSystemSchema = nonEmptyPatch(loggingSystemBase.partial());
export const createLogReviewSchema = logReviewBase;
export const updateLogReviewSchema = nonEmptyPatch(logReviewObject.partial().superRefine(refineLogReview));
