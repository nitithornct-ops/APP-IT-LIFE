import { DataTable } from '../../components/table/DataTable';
import { RowActions } from '../../components/table/RowActions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock, CheckCircle2, ChevronDown, ChevronUp, CircleSlash2, GitBranch,
  Loader2, Play, Plus, Save, Send, ShieldCheck, UserRoundCog, UsersRound, X,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormModal, StatusModal } from '../../components/ui/Modal';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import {
  WORKFLOW_APPROVAL_TYPES, WORKFLOW_DEFINITION_STATUSES, WORKFLOW_STEP_MODES,
  type WorkflowApproval, type WorkflowApprovalType, type WorkflowDefinition,
  type WorkflowInstance, type WorkflowOptions, type WorkflowOverview, type WorkflowStepMode,
} from '../../types/workflows';
import { formatThaiDate } from '../../utils/date';
import { pendingApprovalCount, workflowIsOverdue, workflowProgress } from './workflowDisplay';

const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900';
type Tab = 'approvals' | 'instances' | 'definitions' | 'delegations';

function errorText(reason: unknown, fallback: string) {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : fallback;
}

function statusTone(status: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'secondary' {
  if (['อนุมัติ', 'อนุมัติแล้ว', 'ใช้งาน', 'Active'].includes(status)) return 'success';
  if (['ปฏิเสธ', 'ยกเลิก', 'ผิดพลาด', 'Revoked'].includes(status)) return 'danger';
  if (['รอพิจารณา', 'กำลังดำเนินการ', 'ร่าง'].includes(status)) return 'warning';
  if (status === 'ส่งกลับแก้ไข') return 'info';
  return 'secondary';
}

function dateTime(value: string | null) {
  return value ? formatThaiDate(value, 'd MMM yyyy HH:mm') : '—';
}

interface StepDraft {
  stepCode: string; stepName: string; approvalType: WorkflowApprovalType; approverValue: string;
  mode: WorkflowStepMode; minApprovals: number; slaHours: number; allowDelegation: boolean; allowReturn: boolean;
}

function newStep(order: number): StepDraft {
  return { stepCode: `STEP_${order}`, stepName: `ขั้นอนุมัติ ${order}`, approvalType: 'USER', approverValue: '', mode: 'ANY', minApprovals: 1, slaHours: 24, allowDelegation: true, allowReturn: true };
}

function DefinitionForm({ options, definition, onClose }: { options: WorkflowOptions; definition?: WorkflowDefinition; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    workflowCode: definition?.workflow_code ?? '', workflowName: definition?.workflow_name ?? '',
    moduleKey: definition?.module_key ?? '', description: definition?.description ?? '',
    triggerEvent: definition?.trigger_event ?? 'MANUAL', slaHours: definition?.sla_hours ?? 72,
    isDefault: definition?.is_default ?? false, status: definition?.status ?? 'ร่าง', notes: definition?.notes ?? '',
  });
  const [steps, setSteps] = useState<StepDraft[]>(definition?.steps.length ? definition.steps.map((step) => ({
    stepCode: step.step_code, stepName: step.step_name, approvalType: step.approval_type,
    approverValue: step.approver_value, mode: step.mode, minApprovals: step.min_approvals,
    slaHours: step.sla_hours, allowDelegation: step.allow_delegation, allowReturn: step.allow_return,
  })) : [newStep(1)]);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch(definition ? `/api/v1/workflows/definitions/${definition.id}` : '/api/v1/workflows/definitions', {
      method: definition ? 'PATCH' : 'POST', body: JSON.stringify({ ...form, steps }),
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['workflows'] }); onClose(); },
    onError: (reason) => setError(errorText(reason, 'บันทึกแบบ Workflow ไม่สำเร็จ')),
  });
  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) { setForm((current) => ({ ...current, [key]: value })); }
  function setStep<K extends keyof StepDraft>(index: number, key: K, value: StepDraft[K]) { setSteps((current) => current.map((step, i) => i === index ? { ...step, [key]: value } : step)); }
  function approverOptions(step: StepDraft) {
    if (step.approvalType === 'ROLE') return options.roles.map((item) => ({ value: item.key, label: `${item.name_th} (${item.key})` }));
    if (step.approvalType === 'GROUP') return options.groups.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}` }));
    return options.users.map((item) => ({ value: item.id, label: `${item.full_name} — ${item.email}` }));
  }
  return (
    <Card data-testid="workflow-definition-form" className="border-primary-200 dark:border-primary-900">
      <CardHeader className="flex items-center justify-between"><span>{definition ? `แก้ไข ${definition.workflow_code}` : 'สร้างแบบ Workflow'}</span><button type="button" aria-label="ปิด" onClick={onClose}><X className="h-4 w-4" /></button></CardHeader>
      <CardBody>
        <form className="grid gap-3 md:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
          <label className="text-xs font-semibold">รหัส Workflow<input required pattern="[A-Z0-9][A-Z0-9_-]{2,79}" value={form.workflowCode} disabled={Boolean(definition)} onChange={(event) => set('workflowCode', event.target.value.toUpperCase())} placeholder="PURCHASE_APPROVAL" className={fieldClass} /></label>
          <label className="text-xs font-semibold md:col-span-2">ชื่อ Workflow<input required maxLength={200} value={form.workflowName} onChange={(event) => set('workflowName', event.target.value)} className={fieldClass} /></label>
          <label className="text-xs font-semibold">Module Key<input required maxLength={80} value={form.moduleKey} onChange={(event) => set('moduleKey', event.target.value.toLowerCase())} placeholder="service_request" className={fieldClass} /></label>
          <label className="text-xs font-semibold md:col-span-2">คำอธิบาย<input maxLength={1000} value={form.description} onChange={(event) => set('description', event.target.value)} className={fieldClass} /></label>
          <label className="text-xs font-semibold">Trigger Event<input required maxLength={80} value={form.triggerEvent} onChange={(event) => set('triggerEvent', event.target.value.toUpperCase())} className={fieldClass} /></label>
          <label className="text-xs font-semibold">SLA รวม (ชั่วโมง)<input required type="number" min="1" max="8760" value={form.slaHours} onChange={(event) => set('slaHours', Number(event.target.value))} className={fieldClass} /></label>
          <label className="text-xs font-semibold">สถานะ<select value={form.status} onChange={(event) => set('status', event.target.value as typeof form.status)} className={fieldClass}>{WORKFLOW_DEFINITION_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="mt-6 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={form.isDefault} onChange={(event) => set('isDefault', event.target.checked)} />ใช้เป็นค่าเริ่มต้นของโมดูล</label>
          <label className="text-xs font-semibold md:col-span-2 lg:col-span-4">หมายเหตุ<textarea rows={2} maxLength={1000} value={form.notes} onChange={(event) => set('notes', event.target.value)} className={fieldClass} /></label>
          <div className="md:col-span-2 lg:col-span-4">
            <div className="mb-2 flex items-center justify-between"><p className="text-sm font-bold">ขั้นอนุมัติ</p><Button size="sm" variant="outline" onClick={() => setSteps((current) => [...current, newStep(current.length + 1)])}><Plus className="h-4 w-4" />เพิ่มขั้น</Button></div>
            <div className="space-y-3">
              {steps.map((step, index) => <div key={index} className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40 md:grid-cols-2 lg:grid-cols-6">
                <div className="flex items-center gap-2 lg:col-span-6"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-700 text-xs font-bold text-white">{index + 1}</span><span className="text-sm font-bold">ขั้นที่ {index + 1}</span>{steps.length > 1 && <button type="button" className="ml-auto text-xs text-red-600" onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}>ลบ</button>}</div>
                <label className="text-xs font-semibold">รหัสขั้น<input required value={step.stepCode} onChange={(event) => setStep(index, 'stepCode', event.target.value.toUpperCase())} className={fieldClass} /></label>
                <label className="text-xs font-semibold lg:col-span-2">ชื่อขั้น<input required value={step.stepName} onChange={(event) => setStep(index, 'stepName', event.target.value)} className={fieldClass} /></label>
                <label className="text-xs font-semibold">ประเภท<select value={step.approvalType} onChange={(event) => { setStep(index, 'approvalType', event.target.value as WorkflowApprovalType); setStep(index, 'approverValue', ''); }} className={fieldClass}>{WORKFLOW_APPROVAL_TYPES.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label className="text-xs font-semibold lg:col-span-2">ผู้อนุมัติ<select required value={step.approverValue} onChange={(event) => setStep(index, 'approverValue', event.target.value)} className={fieldClass}><option value="">— เลือก —</option>{approverOptions(step).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                <label className="text-xs font-semibold">โหมด<select value={step.mode} onChange={(event) => setStep(index, 'mode', event.target.value as WorkflowStepMode)} className={fieldClass}>{WORKFLOW_STEP_MODES.map((item) => <option key={item}>{item}</option>)}</select></label>
                <label className="text-xs font-semibold">จำนวนขั้นต่ำ<input type="number" min="1" max="100" value={step.minApprovals} disabled={step.mode !== 'QUORUM'} onChange={(event) => setStep(index, 'minApprovals', Number(event.target.value))} className={fieldClass} /></label>
                <label className="text-xs font-semibold">SLA (ชม.)<input type="number" min="1" max="8760" value={step.slaHours} onChange={(event) => setStep(index, 'slaHours', Number(event.target.value))} className={fieldClass} /></label>
                <label className="mt-6 flex items-center gap-2 text-xs"><input type="checkbox" checked={step.allowDelegation} onChange={(event) => setStep(index, 'allowDelegation', event.target.checked)} />มอบหมายแทนได้</label>
                <label className="mt-6 flex items-center gap-2 text-xs"><input type="checkbox" checked={step.allowReturn} onChange={(event) => setStep(index, 'allowReturn', event.target.checked)} />ส่งกลับได้</label>
              </div>)}
            </div>
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 md:col-span-2 lg:col-span-4 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
          <div className="flex gap-2 md:col-span-2 lg:col-span-4"><Button type="submit" size="sm" isLoading={mutation.isPending} disabled={!form.workflowCode || !form.workflowName || !form.moduleKey || steps.some((step) => !step.approverValue)} data-testid="workflow-definition-submit"><Save className="h-4 w-4" />บันทึกแบบ Workflow</Button><Button size="sm" variant="ghost" onClick={onClose}>ยกเลิก</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}

function StartForm({ definitions, onClose }: { definitions: WorkflowDefinition[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ definitionId: definitions.find((item) => item.status === 'ใช้งาน')?.id ?? '', recordId: '', recordLabel: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({ mutationFn: () => apiFetch('/api/v1/workflows/instances', { method: 'POST', body: JSON.stringify({ ...form, context: {} }) }), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['workflows'] }); onClose(); }, onError: (reason) => setError(errorText(reason, 'เริ่ม Workflow ไม่สำเร็จ')) });
  return <Card data-testid="workflow-start-form" className="border-primary-200"><CardHeader className="flex justify-between"><span>เริ่ม Workflow Instance</span><button type="button" onClick={onClose}><X className="h-4 w-4" /></button></CardHeader><CardBody><form className="grid gap-3 md:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
    <label className="text-xs font-semibold md:col-span-2">แบบ Workflow<select required value={form.definitionId} onChange={(event) => setForm({ ...form, definitionId: event.target.value })} className={fieldClass}><option value="">— เลือกแบบที่ใช้งาน —</option>{definitions.filter((item) => item.status === 'ใช้งาน').map((item) => <option key={item.id} value={item.id}>{item.workflow_code} — {item.workflow_name} (v{item.version})</option>)}</select></label>
    <label className="text-xs font-semibold">Record ID<input required value={form.recordId} onChange={(event) => setForm({ ...form, recordId: event.target.value })} placeholder="REQ-2026-001" className={fieldClass} /></label>
    <label className="text-xs font-semibold">ชื่อรายการ<input required value={form.recordLabel} onChange={(event) => setForm({ ...form, recordLabel: event.target.value })} className={fieldClass} /></label>
    <label className="text-xs font-semibold md:col-span-2 lg:col-span-4">หมายเหตุ<input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className={fieldClass} /></label>
    {error && <p className="text-sm text-red-600 md:col-span-2 lg:col-span-4">{error}</p>}<div className="md:col-span-2 lg:col-span-4"><Button type="submit" size="sm" isLoading={mutation.isPending} disabled={!form.definitionId || !form.recordId || !form.recordLabel} data-testid="workflow-start-submit"><Play className="h-4 w-4" />เริ่ม Workflow</Button></div>
  </form></CardBody></Card>;
}

function DelegationForm({ options, definitions, onClose }: { options: WorkflowOptions; definitions: WorkflowDefinition[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const now = new Date(); const tomorrow = new Date(now.getTime() + 86_400_000);
  const [form, setForm] = useState({ delegateId: '', moduleKey: '', definitionId: '', startAt: now.toISOString().slice(0, 16), endAt: tomorrow.toISOString().slice(0, 16), reason: '' });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({ mutationFn: () => apiFetch('/api/v1/workflows/delegations', { method: 'POST', body: JSON.stringify({ ...form, startAt: new Date(form.startAt).toISOString(), endAt: new Date(form.endAt).toISOString() }) }), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['workflows'] }); onClose(); }, onError: (reason) => setError(errorText(reason, 'ตั้งผู้อนุมัติแทนไม่สำเร็จ')) });
  return <Card data-testid="workflow-delegation-form" className="border-primary-200"><CardHeader className="flex justify-between"><span>ตั้งผู้อนุมัติแทน</span><button type="button" onClick={onClose}><X className="h-4 w-4" /></button></CardHeader><CardBody><form className="grid gap-3 md:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
    <label className="text-xs font-semibold md:col-span-2">ผู้รับงานแทน<select required value={form.delegateId} onChange={(event) => setForm({ ...form, delegateId: event.target.value })} className={fieldClass}><option value="">— เลือกผู้รับแทน —</option>{options.users.map((item) => <option key={item.id} value={item.id}>{item.full_name} — {item.email}</option>)}</select></label>
    <label className="text-xs font-semibold">Module (ว่าง = ทั้งหมด)<input value={form.moduleKey} onChange={(event) => setForm({ ...form, moduleKey: event.target.value.toLowerCase() })} className={fieldClass} /></label>
    <label className="text-xs font-semibold">จำกัดแบบ Workflow<select value={form.definitionId} onChange={(event) => setForm({ ...form, definitionId: event.target.value })} className={fieldClass}><option value="">— ทุกแบบ —</option>{definitions.map((item) => <option key={item.id} value={item.id}>{item.workflow_code}</option>)}</select></label>
    <label className="text-xs font-semibold">เริ่ม<input required type="datetime-local" value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} className={fieldClass} /></label>
    <label className="text-xs font-semibold">สิ้นสุด<input required type="datetime-local" value={form.endAt} onChange={(event) => setForm({ ...form, endAt: event.target.value })} className={fieldClass} /></label>
    <label className="text-xs font-semibold md:col-span-2">เหตุผล<input required maxLength={500} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className={fieldClass} /></label>
    {error && <p className="text-sm text-red-600 md:col-span-2 lg:col-span-4">{error}</p>}<div className="md:col-span-2 lg:col-span-4"><Button type="submit" size="sm" isLoading={mutation.isPending} disabled={!form.delegateId || !form.reason} data-testid="workflow-delegation-submit"><Send className="h-4 w-4" />บันทึกการมอบหมาย</Button></div>
  </form></CardBody></Card>;
}

function ApprovalRow({ approval, instance }: { approval: WorkflowApproval; instance?: WorkflowInstance }) {
  const queryClient = useQueryClient(); const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT' | 'RETURN' | null>(null);
  const [comment, setComment] = useState('');
  const mutation = useMutation({ mutationFn: (payload: { decision: string; comment: string }) => apiFetch(`/api/v1/workflows/approvals/${approval.id}/decision`, { method: 'POST', body: JSON.stringify(payload) }), onSuccess: () => { setDecision(null); setComment(''); void queryClient.invalidateQueries({ queryKey: ['workflows'] }); }, onError: (reason) => setError(errorText(reason, 'บันทึกคำตัดสินไม่สำเร็จ')) });
  const overdue = workflowIsOverdue(approval.due_at, approval.status);
  return <><tr data-testid={`workflow-approval-${approval.id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="px-4 py-3"><p className="font-semibold">{instance?.record_label ?? instance?.record_id ?? approval.instance_id}</p><p className="text-xs text-slate-400">ขั้น {approval.step_order} · {instance?.module_key ?? 'workflow'}</p>{error && <p className="mt-1 text-xs text-red-600">{error}</p>}</td><td className="px-4 py-3"><Badge variant={statusTone(approval.status)}>{approval.status}</Badge></td><td className={`px-4 py-3 text-sm ${overdue ? 'font-semibold text-red-600' : ''}`}>{dateTime(approval.due_at)}{overdue && <p className="text-xs">เกินกำหนด</p>}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-1">{approval.can_act && <><Button size="sm" onClick={() => setDecision('APPROVE')}>อนุมัติ</Button><Button size="sm" variant="danger" onClick={() => setDecision('REJECT')}>ปฏิเสธ</Button><Button size="sm" variant="outline" onClick={() => setDecision('RETURN')}>ส่งกลับ</Button></>}</div></td></tr>{decision && <StatusModal title={decision === 'APPROVE' ? 'อนุมัติรายการ' : decision === 'REJECT' ? 'ปฏิเสธรายการ' : 'ส่งกลับแก้ไข'} description={instance?.record_label ?? instance?.record_id} closeDisabled={mutation.isPending} onClose={() => { setDecision(null); setComment(''); }} footer={<><Button variant="outline" disabled={mutation.isPending} onClick={() => setDecision(null)}>ยกเลิก</Button><Button variant={decision === 'REJECT' ? 'danger' : 'primary'} isLoading={mutation.isPending} disabled={decision !== 'APPROVE' && !comment.trim()} onClick={() => { setError(null); mutation.mutate({ decision, comment }); }}>ยืนยัน</Button></>}><div className="p-5"><label className="text-sm font-semibold text-slate-700 dark:text-slate-200">{decision === 'APPROVE' ? 'ความเห็นประกอบ (ไม่บังคับ)' : 'เหตุผล'}<textarea data-autofocus rows={4} value={comment} onChange={(event) => setComment(event.target.value)} className={fieldClass} /></label>{error && <p className="mt-2 text-sm text-red-600">{error}</p>}</div></StatusModal>}</>;
}

function InstanceRow({ instance }: { instance: WorkflowInstance }) {
  const [expanded, setExpanded] = useState(false); const progress = workflowProgress(instance);
  return <Fragment><tr data-testid={`workflow-instance-${instance.id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="px-4 py-3"><p className="font-semibold">{instance.record_label}</p><p className="text-xs text-slate-400">{instance.instance_code} · {instance.record_id}</p></td><td className="px-4 py-3 text-sm">{instance.definition?.workflow_name ?? '—'}<p className="text-xs text-slate-400">v{instance.definition_version} · {instance.module_key}</p></td><td className="px-4 py-3"><Badge variant={statusTone(instance.status)}>{instance.status}</Badge></td><td className="px-4 py-3 text-sm">{progress.decided}/{progress.total}<div className="mt-1 h-1.5 w-24 overflow-hidden rounded bg-slate-200"><div className="h-full bg-primary-600" style={{ width: `${progress.percent}%` }} /></div></td><td className="px-4 py-3 text-right"><RowActions recordLabel={instance.instance_code} actions={[{ kind: 'view', icon: expanded ? ChevronUp : ChevronDown, label: expanded ? 'ย่อ' : 'รายละเอียด', onClick: () => setExpanded((value) => !value) }]} /></td></tr>{expanded && <tr><td colSpan={5} className="bg-slate-50 px-5 py-4 dark:bg-slate-900/40"><div className="grid gap-4 lg:grid-cols-2"><div><p className="mb-2 text-xs font-bold uppercase text-slate-500">ผู้อนุมัติ</p><div className="space-y-2">{instance.approvals.map((approval) => <div key={approval.id} className="flex items-center justify-between rounded-lg bg-white p-2 text-sm dark:bg-slate-800"><span>{approval.approver?.full_name ?? approval.approver?.email ?? approval.approver_id}<span className="ml-2 text-xs text-slate-400">ขั้น {approval.step_order}</span></span><Badge variant={statusTone(approval.status)}>{approval.status}</Badge></div>)}</div></div><div><p className="mb-2 text-xs font-bold uppercase text-slate-500">Timeline</p><div className="space-y-2">{instance.history.map((item) => <div key={item.id} className="border-l-2 border-primary-300 pl-3 text-sm"><p className="font-semibold">{item.action}</p><p className="text-xs text-slate-500">{item.actor?.full_name ?? 'ระบบ'} · {dateTime(item.action_at)}</p>{item.comment && <p className="mt-1 text-xs">{item.comment}</p>}</div>)}</div></div></div></td></tr>}</Fragment>;
}

export function WorkflowsPage() {
  const { hasPermission } = useAuth(); const canManage = hasPermission('workflow.manage'); const canDelegate = hasPermission('workflow.delegate');
  const [tab, setTab] = useState<Tab>('approvals'); const [showDefinition, setShowDefinition] = useState(false); const [editingDefinition, setEditingDefinition] = useState<WorkflowDefinition>(); const [showStart, setShowStart] = useState(false); const [showDelegation, setShowDelegation] = useState(false);
  const query = useQuery({ queryKey: ['workflows'], queryFn: () => apiFetch<WorkflowOverview>('/api/v1/workflows') });
  const optionsQuery = useQuery({ queryKey: ['workflows', 'options'], enabled: showDefinition || showDelegation, queryFn: () => apiFetch<WorkflowOptions>('/api/v1/workflows/options') });
  const data = query.data; const instanceById = useMemo(() => new Map((data?.instances ?? []).map((item) => [item.id, item])), [data?.instances]);
  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'approvals', label: 'งานอนุมัติของฉัน', count: data?.myApprovals.length ?? 0 },
    { key: 'instances', label: 'Workflow ทั้งหมด', count: data?.instances.length ?? 0 },
    { key: 'definitions', label: 'แบบ Workflow', count: data?.definitions.length ?? 0 },
    { key: 'delegations', label: 'มอบหมายแทน', count: data?.delegations.length ?? 0 },
  ];
  if (query.isLoading) return <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-primary-600" /></div>;
  if (query.isError || !data) return <EmptyState icon={<CircleSlash2 className="h-8 w-8" />} title="โหลด Workflow ไม่สำเร็จ" description={errorText(query.error, 'กรุณาลองใหม่')} />;
  return <div className="space-y-5" data-testid="workflows-page">
    <div className="flex flex-wrap items-start justify-between gap-3"><PageTitle eyebrow="บริการและกระบวนการ IT / งานอนุมัติ Workflow" title="Workflow / งานอนุมัติ" description="Engine กลางสำหรับอนุมัติหลายขั้น มอบหมายแทน และตรวจสอบย้อนหลัง" /><div className="flex flex-wrap gap-2">{canDelegate && <Button variant="outline" onClick={() => setShowDelegation(true)}><UserRoundCog className="h-4 w-4" />ตั้งผู้อนุมัติแทน</Button>}{canManage && <><Button variant="outline" onClick={() => setShowStart(true)}><Play className="h-4 w-4" />เริ่ม Workflow</Button><Button data-testid="workflow-definition-toggle" onClick={() => { setEditingDefinition(undefined); setShowDefinition(true); }}><Plus className="h-4 w-4" />สร้างแบบ</Button></>}</div></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><StatCard icon={<ShieldCheck className="h-5 w-5" />} label="รอฉันอนุมัติ" value={data.summary.pendingMine} tone={data.summary.pendingMine ? 'amber' : 'gray'} /><StatCard icon={<AlarmClock className="h-5 w-5" />} label="เกินกำหนด" value={data.summary.overdueMine} tone={data.summary.overdueMine ? 'danger' : 'gray'} /><StatCard icon={<GitBranch className="h-5 w-5" />} label="คำขอของฉันที่เปิดอยู่" value={data.summary.activeMine} tone="primary" /><StatCard icon={<UsersRound className="h-5 w-5" />} label="กำลังดำเนินการทั้งหมด" value={data.summary.activeVisible} tone="teal" /></div>
    {showDefinition && optionsQuery.data && <FormModal title={editingDefinition ? 'แก้ไขแบบ Workflow' : 'สร้างแบบ Workflow'} description="กำหนดลำดับ ขั้นอนุมัติ และ SLA" size="xl" onClose={() => { setShowDefinition(false); setEditingDefinition(undefined); }}><DefinitionForm options={optionsQuery.data} definition={editingDefinition} onClose={() => { setShowDefinition(false); setEditingDefinition(undefined); }} /></FormModal>}
    {showStart && <FormModal title="เริ่ม Workflow" description="สร้าง instance จากแบบที่เปิดใช้งาน" size="lg" onClose={() => setShowStart(false)}><StartForm definitions={data.definitions} onClose={() => setShowStart(false)} /></FormModal>}
    {showDelegation && optionsQuery.data && <FormModal title="ตั้งผู้อนุมัติแทน" description="กำหนดผู้รับงาน ช่วงเวลา และขอบเขต" size="lg" onClose={() => setShowDelegation(false)}><DelegationForm options={optionsQuery.data} definitions={data.definitions} onClose={() => setShowDelegation(false)} /></FormModal>}
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700">{tabs.map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold ${tab === item.key ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-slate-500'}`}>{item.label} <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-700">{item.count}</span></button>)}</div>
    {tab === 'approvals' && <Card><CardHeader>กล่องงานอนุมัติ</CardHeader><div className="overflow-x-auto">{data.myApprovals.length ? <DataTable className="w-full min-w-[760px] text-left"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900/40"><tr><th className="px-4 py-3">รายการ</th><th className="px-4 py-3">สถานะ</th><th className="px-4 py-3">กำหนด</th><th className="px-4 py-3">ดำเนินการ</th></tr></thead><tbody>{data.myApprovals.map((approval) => <ApprovalRow key={approval.id} approval={approval} instance={instanceById.get(approval.instance_id)} />)}</tbody></DataTable> : <EmptyState icon={<CheckCircle2 className="h-8 w-8" />} title="ไม่มีงานรออนุมัติ" description="งานที่ถูกมอบหมายให้คุณจะแสดงที่นี่" />}</div></Card>}
    {tab === 'instances' && <Card><CardHeader>Workflow Instances</CardHeader><div className="overflow-x-auto">{data.instances.length ? <DataTable className="w-full min-w-[820px] text-left"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900/40"><tr><th className="px-4 py-3">รายการ</th><th className="px-4 py-3">Workflow</th><th className="px-4 py-3">สถานะ</th><th className="px-4 py-3">ความคืบหน้า</th><th className="px-4 py-3"></th></tr></thead><tbody>{data.instances.map((item) => <InstanceRow key={item.id} instance={item} />)}</tbody></DataTable> : <EmptyState icon={<GitBranch className="h-8 w-8" />} title="ยังไม่มี Workflow" description="เริ่ม Workflow จากแบบที่เปิดใช้งาน" />}</div></Card>}
    {tab === 'definitions' && <div className="grid gap-3 lg:grid-cols-2">{data.definitions.map((definition) => <Card key={definition.id} data-testid={`workflow-definition-${definition.id}`}><CardHeader className="flex items-start justify-between"><div><p>{definition.workflow_code}</p><p className="text-sm font-normal text-slate-500">{definition.workflow_name}</p></div><Badge variant={statusTone(definition.status)}>{definition.status}</Badge></CardHeader><CardBody><div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-500"><span>{definition.module_key}</span><span>v{definition.version}</span><span>SLA {definition.sla_hours} ชม.</span>{definition.is_default && <Badge variant="primary">ค่าเริ่มต้น</Badge>}</div><div className="space-y-2">{definition.steps.map((step) => <div key={step.id} className="flex items-center gap-3 rounded-lg bg-slate-50 p-2 dark:bg-slate-900/40"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-700 text-xs font-bold text-white">{step.step_order}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{step.step_name}</p><p className="text-xs text-slate-400">{step.approval_type} · {step.mode} · SLA {step.sla_hours} ชม.</p></div></div>)}</div>{canManage && <Button size="sm" variant="outline" className="mt-3" onClick={() => { setEditingDefinition(definition); setShowDefinition(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>แก้ไข / ออกเวอร์ชันใหม่</Button>}</CardBody></Card>)}{!data.definitions.length && <EmptyState icon={<GitBranch className="h-8 w-8" />} title="ยังไม่มีแบบ Workflow" description="สร้างแบบและกำหนดลำดับผู้อนุมัติ" />}</div>}
    {tab === 'delegations' && <Card><CardHeader>ช่วงมอบหมายงานแทน</CardHeader><div className="overflow-x-auto">{data.delegations.length ? <DataTable className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900/40"><tr><th className="px-4 py-3">ผู้มอบหมาย → ผู้รับแทน</th><th className="px-4 py-3">ขอบเขต</th><th className="px-4 py-3">ช่วงเวลา</th><th className="px-4 py-3">สถานะ</th></tr></thead><tbody>{data.delegations.map((item) => <tr key={item.id} className="border-t border-slate-100 dark:border-slate-700"><td className="px-4 py-3"><p className="font-semibold">{item.delegator?.full_name ?? item.delegator_id}</p><p className="text-xs text-slate-500">→ {item.delegate?.full_name ?? item.delegate_id}</p></td><td className="px-4 py-3">{item.module_key || 'ทุกโมดูล'}<p className="text-xs text-slate-400">{item.definition?.workflow_code}</p></td><td className="px-4 py-3">{dateTime(item.start_at)}<p className="text-xs text-slate-400">ถึง {dateTime(item.end_at)}</p></td><td className="px-4 py-3"><Badge variant={statusTone(item.status)}>{item.status}</Badge></td></tr>)}</tbody></DataTable> : <EmptyState icon={<UserRoundCog className="h-8 w-8" />} title="ยังไม่มีการมอบหมายแทน" description="กำหนดผู้รับงานแทนตามช่วงเวลาและขอบเขต" />}</div></Card>}
    <p className="text-xs text-slate-400">รายการรอพิจารณา {pendingApprovalCount(data.myApprovals)} รายการ · การตัดสินใจทุกครั้งถูกบันทึกใน Audit Log และ Workflow Timeline</p>
  </div>;
}
