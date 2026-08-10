import { z } from 'zod';

const emptyToUndefined = (value: unknown) => value === '' || value === null ? undefined : value;
const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());
const optionalUuid = z.preprocess(emptyToUndefined, z.string().uuid().optional());
const optionalDateTime = z.preprocess(emptyToUndefined, z.string().datetime({ offset: true }).optional());

export const workflowStepSchema = z.object({
  stepCode: z.string().trim().regex(/^[A-Z0-9][A-Z0-9_-]{1,79}$/),
  stepName: z.string().trim().min(1).max(200),
  approvalType: z.enum(['USER', 'ROLE', 'GROUP']),
  approverValue: z.string().trim().min(1).max(120),
  mode: z.enum(['ANY', 'ALL', 'QUORUM']).default('ANY'),
  minApprovals: z.coerce.number().int().min(1).max(100).default(1),
  slaHours: z.coerce.number().int().min(1).max(8760).default(24),
  allowDelegation: z.boolean().default(true),
  allowReturn: z.boolean().default(true),
});

const definitionBase = z.object({
  workflowCode: z.string().trim().regex(/^[A-Z0-9][A-Z0-9_-]{2,79}$/),
  workflowName: z.string().trim().min(1).max(200),
  moduleKey: z.string().trim().regex(/^[a-z][a-z0-9_]{1,79}$/),
  description: optionalText(1000),
  triggerEvent: optionalText(80),
  slaHours: z.coerce.number().int().min(1).max(8760).default(72),
  isDefault: z.boolean().default(false),
  status: z.enum(['ร่าง', 'ใช้งาน', 'ระงับ', 'ยกเลิก']).default('ร่าง'),
  activeFrom: optionalDateTime,
  activeTo: optionalDateTime,
  notes: optionalText(1000),
  steps: z.array(workflowStepSchema).min(1).max(20),
});

function validateDefinition(value: { activeFrom?: string; activeTo?: string; steps: Array<{ stepCode: string }> }, ctx: z.RefinementCtx) {
  if (value.activeFrom && value.activeTo && new Date(value.activeTo) < new Date(value.activeFrom)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['activeTo'], message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น' });
  if (new Set(value.steps.map((step) => step.stepCode)).size !== value.steps.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: 'รหัสขั้นอนุมัติต้องไม่ซ้ำกัน' });
}

export const createWorkflowDefinitionSchema = definitionBase.superRefine(validateDefinition);
export const updateWorkflowDefinitionSchema = definitionBase.omit({ workflowCode: true }).superRefine(validateDefinition);

export const startWorkflowSchema = z.object({
  definitionId: z.string().uuid(),
  recordId: z.string().trim().min(1).max(120),
  recordLabel: z.string().trim().min(1).max(250),
  context: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: optionalText(200),
  notes: optionalText(1000),
});

export const workflowDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'RETURN']),
  comment: optionalText(2000),
}).superRefine((value, ctx) => {
  if (value.decision !== 'APPROVE' && !value.comment) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['comment'], message: 'กรุณาระบุเหตุผลเมื่อปฏิเสธหรือส่งกลับ' });
});

export const createWorkflowDelegationSchema = z.object({
  delegateId: z.string().uuid(),
  moduleKey: optionalText(80),
  definitionId: optionalUuid,
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(1).max(500),
}).superRefine((value, ctx) => {
  if (new Date(value.endAt) <= new Date(value.startAt)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'เวลาสิ้นสุดต้องหลังเวลาเริ่มต้น' });
});

export const revokeWorkflowDelegationSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export const cancelWorkflowSchema = z.object({ reason: z.string().trim().min(1).max(1000) });
