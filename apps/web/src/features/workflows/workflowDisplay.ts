import type { WorkflowApproval, WorkflowInstance, WorkflowStep } from '../../types/workflows';

export function workflowIsOverdue(dueAt: string | null, status: string, now = new Date()): boolean {
  if (!dueAt || status !== 'รอพิจารณา') return false;
  const due = new Date(dueAt);
  return !Number.isNaN(due.getTime()) && due.getTime() < now.getTime();
}

export function workflowProgress(instance: Pick<WorkflowInstance, 'approvals'>): { decided: number; total: number; percent: number } {
  const total = instance.approvals.length;
  const decided = instance.approvals.filter((approval) => approval.status !== 'รอพิจารณา').length;
  return { decided, total, percent: total ? Math.round((decided / total) * 100) : 0 };
}

export function requiredApprovalCount(step: Pick<WorkflowStep, 'mode' | 'min_approvals'>, actorCount: number): number {
  if (step.mode === 'ALL') return actorCount;
  if (step.mode === 'QUORUM') return Math.min(actorCount, Math.max(1, step.min_approvals));
  return Math.min(actorCount, 1);
}

export function pendingApprovalCount(approvals: Array<Pick<WorkflowApproval, 'status'>>): number {
  return approvals.filter((approval) => approval.status === 'รอพิจารณา').length;
}
