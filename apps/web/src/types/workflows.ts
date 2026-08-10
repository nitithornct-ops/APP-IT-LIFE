export const WORKFLOW_DEFINITION_STATUSES = ['ร่าง', 'ใช้งาน', 'ระงับ', 'ยกเลิก'] as const;
export const WORKFLOW_INSTANCE_STATUSES = ['กำลังดำเนินการ', 'อนุมัติแล้ว', 'ปฏิเสธ', 'ส่งกลับแก้ไข', 'ยกเลิก', 'ผิดพลาด'] as const;
export const WORKFLOW_APPROVAL_STATUSES = ['รอพิจารณา', 'อนุมัติ', 'ปฏิเสธ', 'ส่งกลับแก้ไข', 'มอบหมายแทน', 'ข้าม', 'ยกเลิก'] as const;
export const WORKFLOW_APPROVAL_TYPES = ['USER', 'ROLE', 'GROUP'] as const;
export const WORKFLOW_STEP_MODES = ['ANY', 'ALL', 'QUORUM'] as const;
export const WORKFLOW_DECISIONS = ['APPROVE', 'REJECT', 'RETURN'] as const;

export type WorkflowDefinitionStatus = (typeof WORKFLOW_DEFINITION_STATUSES)[number];
export type WorkflowInstanceStatus = (typeof WORKFLOW_INSTANCE_STATUSES)[number];
export type WorkflowApprovalStatus = (typeof WORKFLOW_APPROVAL_STATUSES)[number];
export type WorkflowApprovalType = (typeof WORKFLOW_APPROVAL_TYPES)[number];
export type WorkflowStepMode = (typeof WORKFLOW_STEP_MODES)[number];
export type WorkflowDecision = (typeof WORKFLOW_DECISIONS)[number];

export interface WorkflowProfileRef { id: string; full_name: string; email: string }
export interface WorkflowRoleRef { id: string; key: string; name_th: string }
export interface WorkflowGroupRef { id: string; code: string; name: string }

export interface WorkflowStep {
  id: string; step_order: number; step_code: string; step_name: string;
  approval_type: WorkflowApprovalType; approver_value: string; mode: WorkflowStepMode;
  min_approvals: number; sla_hours: number; allow_delegation: boolean; allow_return: boolean;
  status: 'ใช้งาน' | 'ยกเลิก';
}

export interface WorkflowDefinition {
  id: string; workflow_code: string; workflow_name: string; module_key: string;
  description: string | null; version: number; trigger_event: string | null;
  sla_hours: number; is_default: boolean; status: WorkflowDefinitionStatus;
  active_from: string | null; active_to: string | null; notes: string | null;
  steps: WorkflowStep[];
}

export interface WorkflowApproval {
  id: string; instance_id: string; step_id: string; step_order: number;
  approver_id: string; original_approver_id: string; status: WorkflowApprovalStatus;
  decision: WorkflowDecision | null; comment: string | null; due_at: string | null;
  delegated_at: string | null; decided_at: string | null; decision_by: string | null;
  approver: WorkflowProfileRef | null; original_approver: WorkflowProfileRef | null;
  can_act?: boolean;
}

export interface WorkflowHistory {
  id: string; instance_id: string; approval_id: string | null; action: string;
  step_order: number | null; status_from: string | null; status_to: string | null;
  actor_id: string | null; comment: string | null; detail: Record<string, unknown>;
  action_at: string; actor: WorkflowProfileRef | null;
}

export interface WorkflowInstance {
  id: string; instance_code: string; definition_id: string; definition_version: number;
  module_key: string; record_id: string; record_label: string; requester_id: string;
  current_step_order: number | null; status: WorkflowInstanceStatus; started_at: string;
  due_at: string | null; completed_at: string | null; context: Record<string, unknown>;
  result: Record<string, unknown>; notes: string | null; requester: WorkflowProfileRef | null;
  definition: Pick<WorkflowDefinition, 'id' | 'workflow_code' | 'workflow_name'> | null;
  approvals: WorkflowApproval[]; history: WorkflowHistory[];
}

export interface WorkflowDelegation {
  id: string; delegator_id: string; delegate_id: string; module_key: string | null;
  definition_id: string | null; start_at: string; end_at: string; reason: string;
  status: 'Active' | 'Revoked' | 'Expired'; revoked_at: string | null;
  delegator: WorkflowProfileRef | null; delegate: WorkflowProfileRef | null;
  definition: Pick<WorkflowDefinition, 'id' | 'workflow_code' | 'workflow_name'> | null;
}

export interface WorkflowOverview {
  summary: { pendingMine: number; overdueMine: number; activeMine: number; activeVisible: number };
  capabilities: { canManage: boolean; canApprove: boolean; canDelegate: boolean; canViewAll: boolean };
  myApprovals: WorkflowApproval[];
  instances: WorkflowInstance[];
  definitions: WorkflowDefinition[];
  delegations: WorkflowDelegation[];
}

export interface WorkflowOptions {
  users: WorkflowProfileRef[];
  roles: WorkflowRoleRef[];
  groups: WorkflowGroupRef[];
}
