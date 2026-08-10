import { describe, expect, it } from 'vitest';
import { requiredWorkflowApprovals, workflowDecisionStatus } from '../src/services/workflowEngine';

describe('workflow engine rules', () => {
  it('calculates ANY, ALL and QUORUM thresholds', () => {
    expect(requiredWorkflowApprovals('ANY', 1, 4)).toBe(1);
    expect(requiredWorkflowApprovals('ALL', 1, 4)).toBe(4);
    expect(requiredWorkflowApprovals('QUORUM', 3, 4)).toBe(3);
    expect(requiredWorkflowApprovals('QUORUM', 8, 4)).toBe(4);
  });

  it('maps decisions to governed Thai statuses', () => {
    expect(workflowDecisionStatus('APPROVE')).toBe('อนุมัติ');
    expect(workflowDecisionStatus('REJECT')).toBe('ปฏิเสธ');
    expect(workflowDecisionStatus('RETURN')).toBe('ส่งกลับแก้ไข');
  });
});
