import { describe, expect, it } from 'vitest';
import { pendingApprovalCount, requiredApprovalCount, workflowIsOverdue, workflowProgress } from './workflowDisplay';

describe('workflowDisplay', () => {
  it('marks only overdue pending approvals', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    expect(workflowIsOverdue('2026-08-10T11:00:00Z', 'รอพิจารณา', now)).toBe(true);
    expect(workflowIsOverdue('2026-08-10T11:00:00Z', 'อนุมัติ', now)).toBe(false);
  });

  it('calculates progress and pending count', () => {
    const approvals = [{ status: 'อนุมัติ' }, { status: 'รอพิจารณา' }] as never[];
    expect(workflowProgress({ approvals })).toEqual({ decided: 1, total: 2, percent: 50 });
    expect(pendingApprovalCount(approvals)).toBe(1);
  });

  it('resolves ANY, ALL and QUORUM thresholds', () => {
    expect(requiredApprovalCount({ mode: 'ANY', min_approvals: 1 }, 3)).toBe(1);
    expect(requiredApprovalCount({ mode: 'ALL', min_approvals: 1 }, 3)).toBe(3);
    expect(requiredApprovalCount({ mode: 'QUORUM', min_approvals: 2 }, 3)).toBe(2);
  });
});
