import { paginationQuerySchema } from '@itlife/shared';
import { z } from 'zod';

export const CI_TYPES = [
  'Server', 'VM', 'Database', 'Application', 'Website', 'Network Device', 'Firewall',
  'Switch', 'Access Point', 'Domain', 'SSL Certificate', 'API', 'Cloud Service',
  'Backup Job', 'Business Service', 'Other',
] as const;
export const CI_ENVIRONMENTS = ['Production', 'UAT', 'Development', 'DR', 'Shared', 'N/A'] as const;
export const CI_CRITICALITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export const CI_DATA_CLASSIFICATIONS = ['ไม่ลับ', 'ลับ', 'ลับมาก'] as const;
export const CI_STATUSES = ['Draft', 'Active', 'Maintenance', 'Degraded', 'Retired'] as const;

/** node type ที่ DB CHECK รองรับครบ 8 ประเภทไว้ล่วงหน้า (ตรงกับ migration) และมีตารางจริงให้เลือก 3 ประเภทตอนนี้ */
export const CI_NODE_TYPES = ['CI', 'Asset', 'Vendor', 'Contract', 'Cloud', 'Backup', 'Incident', 'Change'] as const;
export const CI_NODE_TYPES_ENABLED = ['CI', 'Asset', 'Incident'] as const;

export const RELATIONSHIP_TYPES = [
  'DEPENDS_ON', 'RUNS_ON', 'HOSTS', 'CONNECTS_TO', 'USES', 'BACKED_UP_BY',
  'SUPPLIED_BY', 'COVERED_BY_CONTRACT', 'IMPACTED_BY', 'CHANGED_BY', 'LINKED_TO',
] as const;
export const RELATIONSHIP_DIRECTIONS = ['Forward', 'Bidirectional'] as const;
export const RELATIONSHIP_IMPACT_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;
export const RELATIONSHIP_STATUSES = ['Active', 'Inactive'] as const;
const RELATIONSHIP_STATUS_REASON_REQUIRED = ['Inactive'] as const;
const CI_STATUS_REASON_REQUIRED = ['Degraded', 'Retired'] as const;

const isoDateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (yyyy-MM-dd)');
const dateOrEmpty = z.union([isoDateString, z.literal('')]).optional();
/** IPv4/IPv6/CIDR หนึ่งค่าขึ้นไป คั่นด้วย comma/semicolon/space — ตรวจแบบผ่อนปรน (ไม่ใช่ security boundary) */
const ipListPattern = /^[0-9a-fA-F:./]+(\s*[,;]\s*[0-9a-fA-F:./]+)*$/;

const configurationItemFields = {
  name: z.string().trim().min(1, 'กรุณากรอกชื่อ CI').max(200),
  ciType: z.enum(CI_TYPES),
  environment: z.enum(CI_ENVIRONMENTS),
  businessService: z.string().trim().max(200).optional(),
  ownerEmployeeId: z.string().uuid('กรุณาเลือกเจ้าของ CI'),
  administratorEmployeeId: z.string().uuid('กรุณาเลือกผู้ดูแล CI'),
  criticality: z.enum(CI_CRITICALITIES).optional(),
  ipAddress: z.union([z.string().trim().max(500).regex(ipListPattern, 'รูปแบบ IP ไม่ถูกต้อง'), z.literal('')]).optional(),
  url: z.union([z.string().trim().max(500).regex(/^https?:\/\//, 'URL ต้องขึ้นต้นด้วย http:// หรือ https://'), z.literal('')]).optional(),
  version: z.string().trim().max(100).optional(),
  vendorName: z.string().trim().max(160).optional(),
  contractRef: z.string().trim().max(150).optional(),
  assetId: z.string().uuid().optional(),
  cloudRef: z.string().trim().max(100).optional(),
  dataClassification: z.enum(CI_DATA_CLASSIFICATIONS).optional(),
  rpoHours: z.coerce.number().min(0).max(87600).optional(),
  rtoHours: z.coerce.number().min(0).max(87600).optional(),
  backupRequired: z.coerce.boolean().optional(),
  backupReference: z.string().trim().max(150).optional(),
  location: z.string().trim().max(300).optional(),
  status: z.enum(CI_STATUSES).optional(),
  notes: z.string().trim().max(2000).optional(),
};

/** ค่า refine เดียวกับที่ DB บังคับด้วย CHECK constraint (configuration_items_backup_reference_required) —
 * ตรวจซ้ำที่นี่เพื่อ error message ที่เจาะจงฟิลด์ ไม่ใช่รอ error ทั่วไปจาก DB */
export const createConfigurationItemSchema = z.object(configurationItemFields).refine((data) => !data.backupRequired || Boolean(data.backupReference), {
  message: 'กรุณาระบุ Backup Reference เมื่อ Backup Required = ใช่',
  path: ['backupReference'],
});
export type CreateConfigurationItemInput = z.infer<typeof createConfigurationItemSchema>;

export const updateConfigurationItemSchema = z.object(configurationItemFields).partial();
export type UpdateConfigurationItemInput = z.infer<typeof updateConfigurationItemSchema>;

export const listConfigurationItemsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  ciType: z.enum(CI_TYPES).optional(),
  environment: z.enum(CI_ENVIRONMENTS).optional(),
  criticality: z.enum(CI_CRITICALITIES).optional(),
  status: z.enum(CI_STATUSES).optional(),
});
export type ListConfigurationItemsQuery = z.infer<typeof listConfigurationItemsQuerySchema>;

export const setConfigurationItemStatusSchema = z
  .object({
    status: z.enum(CI_STATUSES),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((data) => !(CI_STATUS_REASON_REQUIRED as readonly string[]).includes(data.status) || Boolean(data.reason), {
    message: 'กรุณาระบุเหตุผลเมื่อเปลี่ยนสถานะเป็น Degraded/Retired',
    path: ['reason'],
  });
export type SetConfigurationItemStatusInput = z.infer<typeof setConfigurationItemStatusSchema>;

export const verifyConfigurationItemSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type VerifyConfigurationItemInput = z.infer<typeof verifyConfigurationItemSchema>;

// ===== CI Relationships =====

const ciRelationshipFields = {
  sourceType: z.enum(CI_NODE_TYPES),
  sourceId: z.string().uuid('กรุณาเลือกต้นทาง'),
  targetType: z.enum(CI_NODE_TYPES),
  targetId: z.string().uuid('กรุณาเลือกปลายทาง'),
  relationshipType: z.enum(RELATIONSHIP_TYPES),
  direction: z.enum(RELATIONSHIP_DIRECTIONS).optional(),
  impactLevel: z.enum(RELATIONSHIP_IMPACT_LEVELS).optional(),
  description: z.string().trim().max(1500).optional(),
  validFrom: dateOrEmpty,
  validUntil: dateOrEmpty,
  notes: z.string().trim().max(2000).optional(),
};

export const createCiRelationshipSchema = z
  .object(ciRelationshipFields)
  .refine((data) => !(data.sourceType === data.targetType && data.sourceId === data.targetId), {
    message: 'ต้นทางและปลายทางต้องไม่ใช่ node เดียวกัน',
    path: ['targetId'],
  })
  .refine((data) => !data.validFrom || !data.validUntil || data.validUntil >= data.validFrom, {
    message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น',
    path: ['validUntil'],
  });
export type CreateCiRelationshipInput = z.infer<typeof createCiRelationshipSchema>;

export const updateCiRelationshipSchema = z.object({
  relationshipType: z.enum(RELATIONSHIP_TYPES).optional(),
  direction: z.enum(RELATIONSHIP_DIRECTIONS).optional(),
  impactLevel: z.enum(RELATIONSHIP_IMPACT_LEVELS).optional(),
  description: z.string().trim().max(1500).optional(),
  validFrom: dateOrEmpty,
  validUntil: dateOrEmpty,
  notes: z.string().trim().max(2000).optional(),
});
export type UpdateCiRelationshipInput = z.infer<typeof updateCiRelationshipSchema>;

export const listCiRelationshipsQuerySchema = paginationQuerySchema.extend({
  relationshipType: z.enum(RELATIONSHIP_TYPES).optional(),
  status: z.enum(RELATIONSHIP_STATUSES).optional(),
});
export type ListCiRelationshipsQuery = z.infer<typeof listCiRelationshipsQuerySchema>;

export const setCiRelationshipStatusSchema = z
  .object({
    status: z.enum(RELATIONSHIP_STATUSES),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((data) => !(RELATIONSHIP_STATUS_REASON_REQUIRED as readonly string[]).includes(data.status) || Boolean(data.reason), {
    message: 'กรุณาระบุเหตุผลเมื่อปิดใช้งานความสัมพันธ์',
    path: ['reason'],
  });
export type SetCiRelationshipStatusInput = z.infer<typeof setCiRelationshipStatusSchema>;

export const verifyCiRelationshipSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type VerifyCiRelationshipInput = z.infer<typeof verifyCiRelationshipSchema>;
