import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Wrench, X } from 'lucide-react';
import { useState } from 'react';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Employee, PaginatedResult } from '../../types/admin';
import type { AssetOption, ChecklistItem, MaintenancePlan, PmTemplate } from '../../types/assets';
import type { ContractOption, ContractVendorRef } from '../../types/vendorsContracts';
import { PM_CHECK_RESULTS, PM_RECURRENCES, PM_STATUSES } from '../../types/assets';
import { formatThaiDate } from '../../utils/date';

const statusTone: Record<string, 'secondary' | 'primary' | 'success' | 'danger'> = {
  วางแผน: 'secondary',
  กำลังดำเนินการ: 'primary',
  ดำเนินการแล้ว: 'success',
  ยกเลิก: 'danger',
};

function CreatePlanForm({ assets, technicians, templates, vendors, contracts, onClose }: { assets: AssetOption[]; technicians: Employee[]; templates: PmTemplate[]; vendors: ContractVendorRef[]; contracts: ContractOption[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [assetId, setAssetId] = useState('');
  const [planDate, setPlanDate] = useState('');
  const [recurrence, setRecurrence] = useState<(typeof PM_RECURRENCES)[number]>('ครั้งเดียว');
  const [technicianId, setTechnicianId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [contractId, setContractId] = useState('');
  const [notes, setNotes] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/maintenance-plans', {
        method: 'POST',
        body: JSON.stringify({
          assetId,
          planDate,
          recurrence,
          technicianId: technicianId || undefined,
          templateId: templateId || undefined,
          vendorId: vendorId || undefined,
          contractId: contractId || undefined,
          notes: notes || undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['maintenance-plans'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เพิ่มแผน PM ไม่สำเร็จ'),
  });

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex items-center justify-between sm:col-span-3">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">เพิ่มแผน PM</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ทรัพย์สิน</label>
        <select data-testid="pm-create-asset" value={assetId} onChange={(e) => setAssetId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900">
          <option value="">— เลือกทรัพย์สิน —</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.asset_code} — {a.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">วันที่วางแผน</label>
        <input data-testid="pm-create-date" type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">รอบดำเนินการ</label>
        <select
          data-testid="pm-create-recurrence"
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value as (typeof PM_RECURRENCES)[number])}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
        >
          {PM_RECURRENCES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ช่าง/ผู้รับผิดชอบ</label>
        <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900">
          <option value="">— ไม่ระบุ —</option>
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>{[t.prefix_th, t.first_name_th, t.last_name_th].filter(Boolean).join(' ')}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">เทมเพลตเช็กลิสต์</label>
        <select
          data-testid="pm-create-template"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
        >
          <option value="">— ไม่ใช้เทมเพลต —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้ให้บริการ PM</label>
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">— ไม่ระบุ —</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_code} — {vendor.name}</option>)}</select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สัญญา MA</label>
        <select value={contractId} onChange={(e) => setContractId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">— ไม่ระบุ —</option>{contracts.filter((contract) => !vendorId || contract.vendor_id === vendorId).map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_number} — {contract.name}</option>)}</select>
      </div>
      <div className="sm:col-span-3">
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หมายเหตุ</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      {serverError && <p className="text-xs text-red-600 sm:col-span-3">{serverError}</p>}
      <div className="sm:col-span-3">
        <Button size="sm" isLoading={mutation.isPending} disabled={!assetId || !planDate} data-testid="pm-create-submit" onClick={() => mutation.mutate()}>
          บันทึกแผน PM
        </Button>
      </div>
    </div>
  );
}

function PlanActions({ plan, technicians, onDone }: { plan: MaintenancePlan; technicians: Employee[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<null | 'start' | 'result' | 'reschedule' | 'cancel'>(null);
  const [technicianId, setTechnicianId] = useState('');
  const [resultStatus, setResultStatus] = useState<(typeof PM_STATUSES)[number]>('ดำเนินการแล้ว');
  const [checklistResults, setChecklistResults] = useState<ChecklistItem[]>(plan.checklist_json ?? []);
  const [resultNotes, setResultNotes] = useState('');
  const [newDate, setNewDate] = useState(plan.plan_date);
  const [reason, setReason] = useState('');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['maintenance-plans'] });
    onDone();
  };

  const startMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/maintenance-plans/${plan.id}/start`, { method: 'POST', body: JSON.stringify({ technicianId: technicianId || undefined }) }),
    onSuccess: () => { setMode(null); invalidate(); },
  });
  const resultMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/maintenance-plans/${plan.id}/result`, {
        method: 'POST',
        body: JSON.stringify({ status: resultStatus, checklistResults: checklistResults.length ? checklistResults : undefined, notes: resultNotes || undefined }),
      }),
    onSuccess: () => { setMode(null); invalidate(); },
  });
  const rescheduleMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/maintenance-plans/${plan.id}/reschedule`, { method: 'POST', body: JSON.stringify({ planDate: newDate, reason: reason || undefined }) }),
    onSuccess: () => { setMode(null); invalidate(); },
  });
  const cancelMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/maintenance-plans/${plan.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: reason || undefined }) }),
    onSuccess: () => { setMode(null); invalidate(); },
  });

  const terminal = plan.status === 'ดำเนินการแล้ว' || plan.status === 'ยกเลิก';

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700" data-testid={`pm-actions-${plan.id}`}>
      <div className="mb-2 flex flex-wrap gap-2">
        {!terminal && (
          <button type="button" data-testid={`pm-action-start-${plan.id}`} onClick={() => setMode(mode === 'start' ? null : 'start')} className="rounded-full border border-slate-300 px-3 py-1 text-xs dark:border-slate-600">เริ่มดำเนินการ</button>
        )}
        {!terminal && (
          <button type="button" data-testid={`pm-action-result-${plan.id}`} onClick={() => setMode(mode === 'result' ? null : 'result')} className="rounded-full border border-slate-300 px-3 py-1 text-xs dark:border-slate-600">บันทึกผล</button>
        )}
        {!terminal && (
          <button type="button" data-testid={`pm-action-reschedule-${plan.id}`} onClick={() => setMode(mode === 'reschedule' ? null : 'reschedule')} className="rounded-full border border-slate-300 px-3 py-1 text-xs dark:border-slate-600">เลื่อนวัน</button>
        )}
        {plan.status !== 'ดำเนินการแล้ว' && (
          <button type="button" data-testid={`pm-action-cancel-${plan.id}`} onClick={() => setMode(mode === 'cancel' ? null : 'cancel')} className="rounded-full border border-slate-300 px-3 py-1 text-xs text-red-600 dark:border-slate-600">ยกเลิก</button>
        )}
      </div>

      {mode === 'start' && (
        <div className="flex items-center gap-2">
          <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900">
            <option value="">— ไม่เปลี่ยนช่าง —</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>{[t.prefix_th, t.first_name_th, t.last_name_th].filter(Boolean).join(' ')}</option>
            ))}
          </select>
          <Button size="sm" isLoading={startMutation.isPending} data-testid={`pm-start-submit-${plan.id}`} onClick={() => startMutation.mutate()}>ยืนยันเริ่มงาน</Button>
        </div>
      )}

      {mode === 'result' && (
        <div className="flex flex-col gap-2">
          <select value={resultStatus} onChange={(e) => setResultStatus(e.target.value as (typeof PM_STATUSES)[number])} data-testid={`pm-result-status-${plan.id}`} className="w-fit rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900">
            {PM_STATUSES.filter((s) => s !== 'วางแผน').map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {checklistResults.map((item, idx) => (
            <div key={`${item.text}-${idx}`} className="flex items-center gap-2 text-xs">
              <span className="flex-1">{item.text}</span>
              <select
                value={item.result ?? 'ผ่าน'}
                onChange={(e) => {
                  const next = [...checklistResults];
                  next[idx] = { ...item, result: e.target.value as ChecklistItem['result'] };
                  setChecklistResults(next);
                }}
                className="rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
              >
                {PM_CHECK_RESULTS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          ))}
          <input value={resultNotes} onChange={(e) => setResultNotes(e.target.value)} placeholder="บันทึกเพิ่มเติม" className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900" />
          <Button size="sm" className="w-fit" isLoading={resultMutation.isPending} data-testid={`pm-result-submit-${plan.id}`} onClick={() => resultMutation.mutate()}>บันทึกผล PM</Button>
        </div>
      )}

      {mode === 'reschedule' && (
        <div className="flex items-center gap-2">
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900" />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล" className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900" />
          <Button size="sm" isLoading={rescheduleMutation.isPending} data-testid={`pm-reschedule-submit-${plan.id}`} onClick={() => rescheduleMutation.mutate()}>บันทึก</Button>
        </div>
      )}

      {mode === 'cancel' && (
        <div className="flex items-center gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผลยกเลิก" className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900" />
          <Button size="sm" variant="danger" isLoading={cancelMutation.isPending} data-testid={`pm-cancel-submit-${plan.id}`} onClick={() => cancelMutation.mutate()}>ยืนยันยกเลิก</Button>
        </div>
      )}
    </div>
  );
}

function TemplateManager({ templates }: { templates: PmTemplate[] }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [itemsText, setItemsText] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/pm-templates', {
        method: 'POST',
        body: JSON.stringify({
          name,
          category: category || undefined,
          items: itemsText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pm-templates'] });
      setName('');
      setCategory('');
      setItemsText('');
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เพิ่มเทมเพลตไม่สำเร็จ'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: 'active' | 'inactive' }) =>
      apiFetch(`/api/v1/pm-templates/${id}/status`, { method: 'POST', body: JSON.stringify({ status: nextStatus }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pm-templates'] }),
  });

  return (
    <Card>
      <CardHeader>เทมเพลตเช็กลิสต์ PM</CardHeader>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <input data-testid="pm-template-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อเทมเพลต" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="หมวดหมู่ (ถ้ามี)" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
          <textarea
            data-testid="pm-template-items"
            value={itemsText}
            onChange={(e) => setItemsText(e.target.value)}
            rows={3}
            placeholder="รายการเช็กลิสต์ (บรรทัดละ 1 รายการ)"
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          />
          {serverError && <p className="text-xs text-red-600">{serverError}</p>}
          <Button size="sm" className="w-fit" isLoading={createMutation.isPending} disabled={!name.trim() || !itemsText.trim()} data-testid="pm-template-submit" onClick={() => createMutation.mutate()}>
            เพิ่มเทมเพลต
          </Button>
        </div>
        {templates.map((t) => (
          <div key={t.id} className="flex items-center justify-between text-sm">
            <span>{t.name} <span className="text-xs text-slate-400">({t.items_json.length} รายการ)</span></span>
            <button
              type="button"
              onClick={() => statusMutation.mutate({ id: t.id, nextStatus: t.status === 'active' ? 'inactive' : 'active' })}
              className="text-xs text-primary-700 hover:underline dark:text-primary-300"
            >
              {t.status === 'active' ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
            </button>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export function MaintenancePage() {
  const [showCreate, setShowCreate] = useState(false);
  const [status, setStatus] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const plansQuery = useQuery({
    queryKey: ['maintenance-plans', status],
    queryFn: () => apiFetch<PaginatedResult<MaintenancePlan>>(`/api/v1/maintenance-plans?page=1&pageSize=50${status ? `&status=${encodeURIComponent(status)}` : ''}`),
  });
  const assetsQuery = useQuery({ queryKey: ['assets', 'options'], queryFn: () => apiFetch<AssetOption[]>('/api/v1/assets/options') });
  const employeesQuery = useQuery({ queryKey: ['admin', 'employees', 'all'], queryFn: () => apiFetch<PaginatedResult<Employee>>('/api/v1/employees?page=1&pageSize=100') });
  const templatesQuery = useQuery({ queryKey: ['pm-templates'], queryFn: () => apiFetch<PmTemplate[]>('/api/v1/pm-templates') });
  const templatesAdminQuery = useQuery({ queryKey: ['pm-templates', 'all'], queryFn: () => apiFetch<PmTemplate[]>('/api/v1/pm-templates?includeInactive=true') });
  const vendorOptionsQuery = useQuery({ queryKey: ['vendors-contracts', 'vendor-options'], queryFn: () => apiFetch<ContractVendorRef[]>('/api/v1/vendors/options') });
  const contractOptionsQuery = useQuery({ queryKey: ['vendors-contracts', 'contract-options'], queryFn: () => apiFetch<ContractOption[]>('/api/v1/contracts/options') });

  const items = plansQuery.data?.items ?? [];
  const technicians = employeesQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">PM / บำรุงรักษาเชิงป้องกัน</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">วางแผน ติดตาม และบันทึกผลการบำรุงรักษาทรัพย์สิน IT</p>
        </div>
        <RequirePermission permission="maintenance.manage">
          <Button size="sm" onClick={() => setShowCreate((v) => !v)} data-testid="pm-create-toggle">
            <Plus className="h-4 w-4" aria-hidden="true" />
            เพิ่มแผน PM
          </Button>
        </RequirePermission>
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <span>รายการแผน PM</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-full border border-slate-300 px-3 py-1 text-xs dark:border-slate-600 dark:bg-slate-900">
            <option value="">ทุกสถานะ</option>
            {PM_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </CardHeader>
        <CardBody>
          {showCreate && assetsQuery.data && templatesQuery.data && vendorOptionsQuery.data && contractOptionsQuery.data && (
            <CreatePlanForm assets={assetsQuery.data} technicians={technicians} templates={templatesQuery.data} vendors={vendorOptionsQuery.data} contracts={contractOptionsQuery.data} onClose={() => setShowCreate(false)} />
          )}

          {plansQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}
          {plansQuery.data && items.length === 0 && <EmptyState icon={<Wrench className="h-10 w-10" aria-hidden="true" />} title="ไม่พบแผน PM" />}

          <div className="flex flex-col gap-2">
            {items.map((plan) => (
              <div key={plan.id} data-testid={`pm-row-${plan.id}`} className="rounded-lg border border-slate-100 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-800 dark:text-slate-200">{plan.asset?.asset_code} — {plan.asset?.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      วางแผน {formatThaiDate(plan.plan_date, 'd MMM yyyy')} · {plan.recurrence}
                      {plan.technician && ` · ${[plan.technician.first_name_th, plan.technician.last_name_th].join(' ')}`}
                      {plan.vendor && ` · ${plan.vendor.name}`}{plan.contract && ` · ${plan.contract.contract_number}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusTone[plan.status]}>{plan.status}</Badge>
                    <RequirePermission permission="maintenance.manage">
                      <button type="button" onClick={() => setExpandedId(expandedId === plan.id ? null : plan.id)} className="text-xs text-primary-700 hover:underline dark:text-primary-300">
                        {expandedId === plan.id ? 'ปิด' : 'จัดการ'}
                      </button>
                    </RequirePermission>
                  </div>
                </div>
                {expandedId === plan.id && (
                  <div className="mt-2">
                    <PlanActions plan={plan} technicians={technicians} onDone={() => setExpandedId(null)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <RequirePermission permission="maintenance.manage">
        {templatesAdminQuery.data && <TemplateManager templates={templatesAdminQuery.data} />}
      </RequirePermission>
    </div>
  );
}
