export type WorkflowStepMode = 'ANY' | 'ALL' | 'QUORUM';

/** จำนวนคำอนุมัติที่ทำให้ขั้นปัจจุบันผ่าน โดยไม่ยอมให้ quorum เกินจำนวน actor จริง */
export function requiredWorkflowApprovals(mode: WorkflowStepMode, minApprovals: number, actorCount: number): number {
  if (actorCount <= 0) return 0;
  if (mode === 'ALL') return actorCount;
  if (mode === 'QUORUM') return Math.min(actorCount, Math.max(1, minApprovals));
  return 1;
}

export function workflowDecisionStatus(decision: 'APPROVE' | 'REJECT' | 'RETURN') {
  return ({ APPROVE: 'อนุมัติ', REJECT: 'ปฏิเสธ', RETURN: 'ส่งกลับแก้ไข' } as const)[decision];
}
