import { describe, expect, it } from 'vitest';
import { createWorkflowDefinitionSchema, createWorkflowDelegationSchema, workflowDecisionSchema } from '../src/validators/workflows';

const validDefinition = { workflowCode: 'PURCHASE_APPROVAL', workflowName: 'อนุมัติจัดซื้อ', moduleKey: 'service_request', steps: [{ stepCode: 'MANAGER', stepName: 'หัวหน้าอนุมัติ', approvalType: 'ROLE', approverValue: 'manager', mode: 'ANY', minApprovals: 1, slaHours: 24, allowDelegation: true, allowReturn: true }] };

describe('workflow validators', () => {
  it('accepts a valid versioned definition', () => expect(createWorkflowDefinitionSchema.safeParse(validDefinition).success).toBe(true));
  it('rejects duplicate step codes', () => expect(createWorkflowDefinitionSchema.safeParse({ ...validDefinition, steps: [validDefinition.steps[0], validDefinition.steps[0]] }).success).toBe(false));
  it('requires comments for rejection and return', () => expect(workflowDecisionSchema.safeParse({ decision: 'REJECT', comment: '' }).success).toBe(false));
  it('requires delegation end after start', () => expect(createWorkflowDelegationSchema.safeParse({ delegateId: '11111111-1111-4111-8111-111111111111', startAt: '2026-08-11T10:00:00+07:00', endAt: '2026-08-10T10:00:00+07:00', reason: 'ลา' }).success).toBe(false));
});
