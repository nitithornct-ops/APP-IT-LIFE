import { DataTable, TablePagination } from '../../components/table/DataTable';
import { useTableParams } from '../../hooks/useTableParams';
import { RowActions } from '../../components/table/RowActions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CirclePlay,
  Download,
  FileSpreadsheet,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Repeat2,
  Search,
  UsersRound,
  Wrench,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { Toast, type ToastMessage } from '../../components/ui/Toast';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Employee, EmployeeOption, PaginatedResult } from '../../types/admin';
import type { AssetOption, ChecklistItem, MaintenancePlan, PmTemplate } from '../../types/assets';
import { PM_CHECK_RESULTS, PM_RECURRENCES, PM_STATUSES } from '../../types/assets';
import type { ContractOption, ContractVendorRef } from '../../types/vendorsContracts';
import { downloadCsv } from '../../utils/csv';
import { cn } from '../../utils/cn';
import { formatThaiDate } from '../../utils/date';
import { PmRosterView } from './PmRosterView';

const fieldClass =
  'h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-primary-900/50';

const statusTone: Record<string, 'secondary' | 'primary' | 'success' | 'danger'> = {
  วางแผน: 'secondary',
  กำลังดำเนินการ: 'primary',
  ดำเนินการแล้ว: 'success',
  ยกเลิก: 'danger',
};

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function employeeName(employee: Employee | MaintenancePlan['technician']) {
  if (!employee) return 'ยังไม่ระบุผู้รับผิดชอบ';
  return [
    'prefix_th' in employee ? employee.prefix_th : null,
    employee.first_name_th,
    employee.last_name_th,
  ]
    .filter(Boolean)
    .join(' ');
}

function FormField({ label, required, children, className }: { label: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-5 -mb-5 mt-2 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/40">
      {children}
    </div>
  );
}

function SummaryCard({ icon, label, value, tone, border }: { icon: ReactNode; label: string; value: number; tone: string; border: string }) {
  return (
    <div className={cn('flex min-h-[104px] items-center gap-3 rounded-2xl border border-b-2 border-slate-200 bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800', border)}>
      <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white', tone)}>{icon}</div>
      <div className="min-w-0">
        <p className="text-2xl font-extrabold leading-none text-slate-900 dark:text-white">{value}</p>
        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      </div>
    </div>
  );
}

function CreatePlanForm({
  assets,
  technicians,
  templates,
  vendors,
  contracts,
  onClose,
  onSaved,
}: {
  assets: AssetOption[];
  technicians: EmployeeOption[];
  templates: PmTemplate[];
  vendors: ContractVendorRef[];
  contracts: ContractOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [assetId, setAssetId] = useState('');
  const [planDate, setPlanDate] = useState('');
  const [recurrence, setRecurrence] = useState<(typeof PM_RECURRENCES)[number]>('ครั้งเดียว');
  const [technicianId, setTechnicianId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [contractId, setContractId] = useState('');
  const [checklistText, setChecklistText] = useState('');
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
          checklistItems: templateId
            ? undefined
            : checklistText
                .split('\n')
                .map((text) => text.trim())
                .filter(Boolean)
                .map((text) => ({ text })),
          notes: notes || undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['maintenance-plans'] });
      onSaved();
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เพิ่มแผน PM ไม่สำเร็จ'),
  });

  return (
    <form
      className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (assetId && planDate) mutation.mutate();
      }}
    >
      <FormField label="Asset" required>
        <select data-testid="pm-create-asset" value={assetId} onChange={(event) => setAssetId(event.target.value)} className={fieldClass}>
          <option value="">-- เลือก Asset --</option>
          {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_code} — {asset.name}</option>)}
        </select>
      </FormField>
      <FormField label="วันที่วางแผน" required>
        <input data-testid="pm-create-date" type="date" value={planDate} onChange={(event) => setPlanDate(event.target.value)} className={fieldClass} />
      </FormField>
      <FormField label="รอบทำซ้ำ">
        <select data-testid="pm-create-recurrence" value={recurrence} onChange={(event) => setRecurrence(event.target.value as (typeof PM_RECURRENCES)[number])} className={fieldClass}>
          {PM_RECURRENCES.map((value) => <option key={value}>{value}</option>)}
        </select>
      </FormField>
      <FormField label="ผู้รับผิดชอบ">
        <select value={technicianId} onChange={(event) => setTechnicianId(event.target.value)} className={fieldClass}>
          <option value="">-- เลือก --</option>
          {technicians.map((technician) => <option key={technician.id} value={technician.id}>{employeeName(technician)}</option>)}
        </select>
      </FormField>
      <FormField label="เทมเพลตเช็กลิสต์" className="sm:col-span-2">
        <select data-testid="pm-create-template" value={templateId} onChange={(event) => setTemplateId(event.target.value)} className={fieldClass}>
          <option value="">-- เลือก หรือกรอกหัวข้อตรวจเองด้านล่าง --</option>
          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <span className="mt-1 block text-[11px] text-slate-400">เลือกเทมเพลตแล้ว ระบบจะดึงหัวข้อตรวจให้อัตโนมัติ</span>
      </FormField>
      {!templateId && (
        <FormField label="หัวข้อตรวจ (บรรทัดละ 1 ข้อ)" className="sm:col-span-2">
          <textarea value={checklistText} onChange={(event) => setChecklistText(event.target.value)} rows={3} className={cn(fieldClass, 'h-auto min-h-24 py-2.5')} placeholder="เช่น ตรวจสอบฝุ่นภายในเครื่อง&#10;ตรวจสอบสายไฟและจุดเชื่อมต่อ" />
        </FormField>
      )}
      <FormField label="ผู้ให้บริการ PM">
        <select value={vendorId} onChange={(event) => { setVendorId(event.target.value); setContractId(''); }} className={fieldClass}>
          <option value="">-- ไม่ระบุ --</option>
          {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_code} — {vendor.name}</option>)}
        </select>
      </FormField>
      <FormField label="สัญญา MA">
        <select value={contractId} onChange={(event) => setContractId(event.target.value)} className={fieldClass}>
          <option value="">-- ไม่ระบุ --</option>
          {contracts.filter((contract) => !vendorId || contract.vendor_id === vendorId).map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_number} — {contract.name}</option>)}
        </select>
      </FormField>
      <FormField label="หมายเหตุ" className="sm:col-span-2">
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className={cn(fieldClass, 'h-auto min-h-24 py-2.5')} />
      </FormField>
      {serverError && <p role="alert" className="text-xs text-red-600 sm:col-span-2">{serverError}</p>}
      <div className="sm:col-span-2">
        <ModalFooter>
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button>
          <Button type="submit" isLoading={mutation.isPending} disabled={!assetId || !planDate} data-testid="pm-create-submit">บันทึกแผน</Button>
        </ModalFooter>
      </div>
    </form>
  );
}

type PlanActionMode = 'overview' | 'start' | 'result' | 'reschedule' | 'cancel';

function PlanActions({ plan, technicians, onClose, onSaved }: { plan: MaintenancePlan; technicians: EmployeeOption[]; onClose: () => void; onSaved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<PlanActionMode>('overview');
  const [technicianId, setTechnicianId] = useState(plan.technician_id ?? '');
  const [resultStatus, setResultStatus] = useState<(typeof PM_STATUSES)[number]>('ดำเนินการแล้ว');
  const [checklistResults, setChecklistResults] = useState<ChecklistItem[]>(plan.checklist_json ?? []);
  const [resultNotes, setResultNotes] = useState('');
  const [newDate, setNewDate] = useState(plan.plan_date);
  const [reason, setReason] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const finish = (message: string) => {
    void queryClient.invalidateQueries({ queryKey: ['maintenance-plans'] });
    onSaved(message);
    onClose();
  };
  const mutationOptions = (message: string) => ({
    onSuccess: () => finish(message),
    onError: (error: Error) => setServerError(error instanceof ApiError ? error.message : 'บันทึกข้อมูลไม่สำเร็จ'),
  });
  const startMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/maintenance-plans/${plan.id}/start`, { method: 'POST', body: JSON.stringify({ technicianId: technicianId || undefined }) }),
    ...mutationOptions('เริ่มดำเนินการ PM แล้ว'),
  });
  const resultMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/maintenance-plans/${plan.id}/result`, { method: 'POST', body: JSON.stringify({ status: resultStatus, checklistResults: checklistResults.length ? checklistResults : undefined, notes: resultNotes || undefined }) }),
    ...mutationOptions('บันทึกผล PM สำเร็จ'),
  });
  const rescheduleMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/maintenance-plans/${plan.id}/reschedule`, { method: 'POST', body: JSON.stringify({ planDate: newDate, reason: reason || undefined }) }),
    ...mutationOptions('เลื่อนวันแผน PM สำเร็จ'),
  });
  const cancelMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/maintenance-plans/${plan.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: reason || undefined }) }),
    ...mutationOptions('ยกเลิกแผน PM แล้ว'),
  });
  const terminal = plan.status === 'ดำเนินการแล้ว' || plan.status === 'ยกเลิก';
  const busy = startMutation.isPending || resultMutation.isPending || rescheduleMutation.isPending || cancelMutation.isPending;

  const actionItems = [
    { mode: 'start' as const, label: 'เริ่มดำเนินการ', description: 'มอบหมายผู้รับผิดชอบและเปลี่ยนสถานะงาน', icon: CirclePlay, hidden: terminal, tone: 'text-primary-700 bg-primary-50 dark:bg-primary-900/30' },
    { mode: 'result' as const, label: 'บันทึกผล PM', description: 'กรอกผลตรวจเช็กลิสต์และสรุปผลดำเนินงาน', icon: CheckCircle2, hidden: terminal, tone: 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30' },
    { mode: 'reschedule' as const, label: 'เลื่อนวัน', description: 'กำหนดวันใหม่พร้อมบันทึกเหตุผล', icon: CalendarClock, hidden: terminal, tone: 'text-amber-700 bg-amber-50 dark:bg-amber-900/30' },
    { mode: 'cancel' as const, label: 'ยกเลิกแผน', description: 'ยุติแผนนี้และเก็บเหตุผลไว้ในประวัติ', icon: CircleAlert, hidden: plan.status === 'ดำเนินการแล้ว' || plan.status === 'ยกเลิก', tone: 'text-red-700 bg-red-50 dark:bg-red-900/30' },
  ];

  return (
    <div data-testid={`pm-actions-${plan.id}`}>
      <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-slate-800 dark:text-slate-100">{plan.asset?.asset_code} — {plan.asset?.name}</p>
            <p className="mt-1 text-xs text-slate-500">กำหนด {formatThaiDate(plan.plan_date, 'd MMM yyyy')} · {plan.recurrence}</p>
          </div>
          <Badge variant={statusTone[plan.status]}>{plan.status}</Badge>
        </div>
      </div>
      <div className="p-5">
        {mode === 'overview' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {actionItems.filter((item) => !item.hidden).map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.mode} type="button" data-testid={`pm-action-${item.mode}-${plan.id}`} onClick={() => { setServerError(null); setMode(item.mode); }} className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-left transition hover:border-primary-300 hover:shadow-card dark:border-slate-700 dark:hover:border-primary-700">
                  <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', item.tone)}><Icon className="h-5 w-5" /></span>
                  <span><span className="block text-sm font-bold text-slate-800 dark:text-slate-100">{item.label}</span><span className="mt-1 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{item.description}</span></span>
                </button>
              );
            })}
            {actionItems.every((item) => item.hidden) && <div className="py-8 text-center text-sm text-slate-500 sm:col-span-2">แผนนี้สิ้นสุดแล้ว ไม่มี Action เพิ่มเติม</div>}
          </div>
        )}
        {mode === 'start' && (
          <div className="space-y-4">
            <button type="button" onClick={() => setMode('overview')} className="text-xs font-semibold text-primary-700">← กลับไปเลือก Action</button>
            <FormField label="ผู้รับผิดชอบ">
              <select value={technicianId} onChange={(event) => setTechnicianId(event.target.value)} className={fieldClass}>
                <option value="">-- ไม่เปลี่ยนผู้รับผิดชอบ --</option>
                {technicians.map((technician) => <option key={technician.id} value={technician.id}>{employeeName(technician)}</option>)}
              </select>
            </FormField>
            <p className="rounded-xl bg-primary-50 p-3 text-xs leading-relaxed text-primary-800 dark:bg-primary-900/30 dark:text-primary-200">สถานะแผนจะเปลี่ยนเป็น “กำลังดำเนินการ” ทันทีหลังยืนยัน</p>
          </div>
        )}
        {mode === 'result' && (
          <div className="space-y-4">
            <button type="button" onClick={() => setMode('overview')} className="text-xs font-semibold text-primary-700">← กลับไปเลือก Action</button>
            <FormField label="สถานะหลังบันทึก">
              <select value={resultStatus} onChange={(event) => setResultStatus(event.target.value as (typeof PM_STATUSES)[number])} data-testid={`pm-result-status-${plan.id}`} className={fieldClass}>
                {PM_STATUSES.filter((value) => value !== 'วางแผน').map((value) => <option key={value}>{value}</option>)}
              </select>
            </FormField>
            {checklistResults.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">ผลตรวจเช็กลิสต์</div>
                {checklistResults.map((item, index) => (
                  <div key={`${item.text}-${index}`} className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 text-sm dark:border-slate-700 sm:flex-row sm:items-center">
                    <span className="flex-1 text-slate-700 dark:text-slate-200">{index + 1}. {item.text}</span>
                    <select value={item.result ?? 'ผ่าน'} onChange={(event) => { const next = [...checklistResults]; next[index] = { ...item, result: event.target.value as ChecklistItem['result'] }; setChecklistResults(next); }} className={cn(fieldClass, 'h-9 sm:w-36')}>
                      {PM_CHECK_RESULTS.map((value) => <option key={value}>{value}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
            <FormField label="สรุปผล / หมายเหตุ">
              <textarea value={resultNotes} onChange={(event) => setResultNotes(event.target.value)} rows={3} className={cn(fieldClass, 'h-auto min-h-24 py-2.5')} />
            </FormField>
          </div>
        )}
        {mode === 'reschedule' && (
          <div className="space-y-4">
            <button type="button" onClick={() => setMode('overview')} className="text-xs font-semibold text-primary-700">← กลับไปเลือก Action</button>
            <FormField label="วันที่วางแผนใหม่" required><input type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} className={fieldClass} /></FormField>
            <FormField label="เหตุผล"><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className={cn(fieldClass, 'h-auto min-h-24 py-2.5')} /></FormField>
          </div>
        )}
        {mode === 'cancel' && (
          <div className="space-y-4">
            <button type="button" onClick={() => setMode('overview')} className="text-xs font-semibold text-primary-700">← กลับไปเลือก Action</button>
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">ยืนยันว่าต้องการยกเลิกแผน PM นี้ กรุณาระบุเหตุผลเพื่อใช้ตรวจสอบย้อนหลัง</div>
            <FormField label="เหตุผลยกเลิก"><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className={cn(fieldClass, 'h-auto min-h-24 py-2.5')} /></FormField>
          </div>
        )}
        {serverError && <p role="alert" className="mt-4 text-xs text-red-600">{serverError}</p>}
        <ModalFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>ปิด</Button>
          {mode === 'start' && <Button isLoading={startMutation.isPending} data-testid={`pm-start-submit-${plan.id}`} onClick={() => startMutation.mutate()}>ยืนยันเริ่มงาน</Button>}
          {mode === 'result' && <Button isLoading={resultMutation.isPending} data-testid={`pm-result-submit-${plan.id}`} onClick={() => resultMutation.mutate()}>บันทึกผล PM</Button>}
          {mode === 'reschedule' && <Button isLoading={rescheduleMutation.isPending} disabled={!newDate} data-testid={`pm-reschedule-submit-${plan.id}`} onClick={() => rescheduleMutation.mutate()}>บันทึกวันใหม่</Button>}
          {mode === 'cancel' && <Button variant="danger" isLoading={cancelMutation.isPending} data-testid={`pm-cancel-submit-${plan.id}`} onClick={() => cancelMutation.mutate()}>ยืนยันยกเลิก</Button>}
        </ModalFooter>
      </div>
    </div>
  );
}

function TemplateManager({ templates, onSaved }: { templates: PmTemplate[]; onSaved: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [itemsText, setItemsText] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: () => apiFetch('/api/v1/pm-templates', { method: 'POST', body: JSON.stringify({ name, category: category || undefined, items: itemsText.split('\n').map((line) => line.trim()).filter(Boolean) }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pm-templates'] });
      setName(''); setCategory(''); setItemsText(''); setShowForm(false); onSaved('เพิ่มเทมเพลตสำเร็จ');
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เพิ่มเทมเพลตไม่สำเร็จ'),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: 'active' | 'inactive' }) => apiFetch(`/api/v1/pm-templates/${id}/status`, { method: 'POST', body: JSON.stringify({ status: nextStatus }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['pm-templates'] }); onSaved('อัปเดตสถานะเทมเพลตแล้ว'); },
  });

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><p className="text-sm font-bold text-slate-800 dark:text-slate-100">เทมเพลตทั้งหมด</p><p className="text-xs text-slate-500">สร้างชุดหัวข้อตรวจเพื่อนำกลับมาใช้กับแผนใหม่</p></div>
        <Button size="sm" onClick={() => setShowForm((value) => !value)}><Plus className="h-4 w-4" /> เพิ่มเทมเพลต</Button>
      </div>
      {showForm && (
        <form className="mb-4 grid gap-3 rounded-xl border border-primary-200 bg-primary-50/60 p-4 dark:border-primary-800 dark:bg-primary-900/20 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (name.trim() && itemsText.trim()) createMutation.mutate(); }}>
          <FormField label="ชื่อเทมเพลต" required><input data-testid="pm-template-name" value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} /></FormField>
          <FormField label="หมวดหมู่"><input value={category} onChange={(event) => setCategory(event.target.value)} className={fieldClass} /></FormField>
          <FormField label="หัวข้อตรวจ (บรรทัดละ 1 ข้อ)" required className="sm:col-span-2"><textarea data-testid="pm-template-items" value={itemsText} onChange={(event) => setItemsText(event.target.value)} rows={4} className={cn(fieldClass, 'h-auto min-h-28 py-2.5')} /></FormField>
          {serverError && <p className="text-xs text-red-600 sm:col-span-2">{serverError}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" size="sm" variant="outline" onClick={() => setShowForm(false)}>ยกเลิก</Button><Button type="submit" size="sm" isLoading={createMutation.isPending} disabled={!name.trim() || !itemsText.trim()} data-testid="pm-template-submit">บันทึกเทมเพลต</Button></div>
        </form>
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
        {templates.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-400">ยังไม่มีเทมเพลตเช็กลิสต์</p>}
        {templates.map((template, index) => (
          <div key={template.id} className={cn('flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center', index > 0 && 'border-t border-slate-100 dark:border-slate-700')}>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-slate-800 dark:text-slate-100">{template.name}</p><Badge variant={template.status === 'active' ? 'success' : 'secondary'}>{template.status === 'active' ? 'ใช้งาน' : 'ปิดใช้งาน'}</Badge></div><p className="mt-1 text-xs text-slate-500">{template.category || 'ไม่ระบุหมวดหมู่'} · {template.items_json.length} หัวข้อตรวจ</p></div>
            <Button size="sm" variant="outline" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ id: template.id, nextStatus: template.status === 'active' ? 'inactive' : 'active' })}>{template.status === 'active' ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsPanel({ plans }: { plans: MaintenancePlan[] }) {
  const completed = plans.filter((plan) => plan.status === 'ดำเนินการแล้ว');
  const passCount = completed.filter((plan) => plan.checklist_json.length > 0 && plan.checklist_json.every((item) => item.result === 'ผ่าน' || item.result === 'N/A')).length;
  const recurring = plans.filter((plan) => plan.recurrence !== 'ครั้งเดียว').length;
  const onTime = completed.filter((plan) => !plan.actual_date || plan.actual_date <= plan.plan_date).length;
  const metrics = [
    { label: 'อัตราปิดงาน', value: plans.length ? Math.round((completed.length / plans.length) * 100) : 0, suffix: '%' },
    { label: 'เสร็จตามกำหนด', value: completed.length ? Math.round((onTime / completed.length) * 100) : 0, suffix: '%' },
    { label: 'เช็กลิสต์ผ่านทั้งหมด', value: completed.length ? Math.round((passCount / completed.length) * 100) : 0, suffix: '%' },
    { label: 'แผนแบบทำซ้ำ', value: recurring, suffix: ' แผน' },
  ];
  return (
    <div className="space-y-5 p-5">
      <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">ภาพรวมคำนวณจากรายการที่ระบบโหลดล่าสุด ช่วยให้เห็นประสิทธิภาพของงาน PM ได้เร็วขึ้น</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {metrics.map((metric) => <div key={metric.label} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><div className="flex items-end justify-between gap-3"><p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{metric.label}</p><p className="text-2xl font-extrabold text-primary-700 dark:text-primary-300">{metric.value}{metric.suffix}</p></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-full rounded-full bg-primary-600" style={{ width: `${metric.suffix === '%' ? metric.value : Math.min(100, (metric.value / Math.max(1, plans.length)) * 100)}%` }} /></div></div>)}
      </div>
      <div className="rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:bg-slate-900/40 dark:text-slate-300"><strong>ข้อเสนอแนะ:</strong> ถ้า “เสร็จตามกำหนด” ต่ำกว่า 80% ควรทบทวนภาระงานผู้รับผิดชอบและระยะเวลานัดหมายกับผู้ให้บริการ</div>
    </div>
  );
}

function CalendarView({ plans, month, onMonthChange, onSelect }: { plans: MaintenancePlan[]; month: Date; onMonthChange: (date: Date) => void; onSelect: (plan: MaintenancePlan) => void }) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const dateMap = new Map<string, MaintenancePlan[]>();
  plans.forEach((plan) => {
    const list = dateMap.get(plan.plan_date) ?? [];
    list.push(plan);
    dateMap.set(plan.plan_date, list);
  });
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, index) => index < firstDay ? null : index - firstDay + 1);
  while (cells.length % 7 !== 0) cells.push(null);
  const monthLabel = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(month);
  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <button type="button" aria-label="เดือนก่อนหน้า" onClick={() => onMonthChange(new Date(year, monthIndex - 1, 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 dark:border-slate-600"><ChevronLeft className="h-4 w-4" /></button>
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{monthLabel}</h2>
        <button type="button" aria-label="เดือนถัดไป" onClick={() => onMonthChange(new Date(year, monthIndex + 1, 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 dark:border-slate-600"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid min-w-[760px] grid-cols-7 bg-slate-50 text-center text-xs font-semibold text-slate-500 dark:bg-slate-900/40">{['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'].map((day) => <div key={day} className="border-b border-r border-slate-200 px-2 py-2 last:border-r-0 dark:border-slate-700">{day}</div>)}</div>
      <div className="grid min-w-[760px] grid-cols-7">{cells.map((day, index) => {
        const key = day ? `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
        const dayPlans = key ? dateMap.get(key) ?? [] : [];
        return <div key={`${day ?? 'blank'}-${index}`} className="min-h-28 border-b border-r border-slate-100 p-2 last:border-r-0 dark:border-slate-700">{day && <><span className={cn('grid h-7 w-7 place-items-center rounded-full text-xs font-semibold text-slate-600 dark:text-slate-300', key === localDateKey() && 'bg-primary-700 text-white')}>{day}</span><div className="mt-1 space-y-1">{dayPlans.slice(0, 3).map((plan) => <button key={plan.id} type="button" onClick={() => onSelect(plan)} className={cn('block w-full truncate rounded px-1.5 py-1 text-left text-[10px] font-semibold', plan.status === 'ดำเนินการแล้ว' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30' : plan.status === 'ยกเลิก' ? 'bg-red-50 text-red-600 dark:bg-red-900/30' : 'bg-primary-50 text-primary-700 dark:bg-primary-900/30')}>{plan.asset?.asset_code ?? 'PM'} · {plan.asset?.name}</button>)}{dayPlans.length > 3 && <p className="px-1 text-[10px] text-slate-400">+{dayPlans.length - 3} รายการ</p>}</div></>}</div>;
      })}</div>
    </div>
  );
}

function ExportPanel({ plans, onClose }: { plans: MaintenancePlan[]; onClose: () => void }) {
  const download = () => {
    const headers = ['Asset Code', 'Asset Name', 'Plan Date', 'Recurrence', 'Owner', 'Status'];
    const rows = plans.map((plan) => [plan.asset?.asset_code ?? '', plan.asset?.name ?? '', plan.plan_date, plan.recurrence, employeeName(plan.technician), plan.status]);
    downloadCsv([headers, ...rows], `pm-plans-${localDateKey()}.csv`);
    onClose();
  };
  return (
    <div className="p-5">
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30"><FileSpreadsheet className="h-5 w-5" /></span><div><p className="font-bold text-slate-800 dark:text-slate-100">CSV สำหรับ Excel / Google Sheets</p><p className="mt-1 text-xs leading-relaxed text-slate-500">ส่งออก {plans.length} รายการตามตัวกรองปัจจุบัน พร้อม Asset, วันกำหนด, รอบ, ผู้รับผิดชอบ และสถานะ</p></div></div>
      <ModalFooter><Button variant="outline" onClick={onClose}>ยกเลิก</Button><Button onClick={download}><Download className="h-4 w-4" /> ดาวน์โหลด CSV</Button></ModalFooter>
    </div>
  );
}

export function MaintenancePage() {
  const [showCreate, setShowCreate] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<MaintenancePlan | null>(null);
  const table = useTableParams<'status' | 'recurrence' | 'search' | 'view'>({ filters: ['status', 'recurrence', 'search', 'view'] });
  const { page, pageSize } = table;
  const { status, recurrence, search } = table.filters;
  const view: 'list' | 'calendar' | 'roster' = table.filters.view === 'calendar' ? 'calendar' : table.filters.view === 'roster' ? 'roster' : 'list';
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const plansQuery = useQuery({ queryKey: ['maintenance-plans', 'dashboard'], queryFn: () => apiFetch<PaginatedResult<MaintenancePlan>>('/api/v1/maintenance-plans?page=1&pageSize=100') });
  const plannedCountQuery = useQuery({ queryKey: ['maintenance-plans', 'count', 'วางแผน'], queryFn: () => apiFetch<PaginatedResult<MaintenancePlan>>(`/api/v1/maintenance-plans?page=1&pageSize=100&status=${encodeURIComponent('วางแผน')}`) });
  const completedCountQuery = useQuery({ queryKey: ['maintenance-plans', 'count', 'ดำเนินการแล้ว'], queryFn: () => apiFetch<PaginatedResult<MaintenancePlan>>(`/api/v1/maintenance-plans?page=1&pageSize=1&status=${encodeURIComponent('ดำเนินการแล้ว')}`) });
  const assetsQuery = useQuery({ queryKey: ['assets', 'options'], queryFn: () => apiFetch<AssetOption[]>('/api/v1/assets/options') });
  const employeesQuery = useQuery({ queryKey: ['employee-options'], queryFn: () => apiFetch<EmployeeOption[]>('/api/v1/employees/options') });
  const templatesQuery = useQuery({ queryKey: ['pm-templates'], queryFn: () => apiFetch<PmTemplate[]>('/api/v1/pm-templates') });
  const templatesAdminQuery = useQuery({ queryKey: ['pm-templates', 'all'], queryFn: () => apiFetch<PmTemplate[]>('/api/v1/pm-templates?includeInactive=true') });
  const vendorOptionsQuery = useQuery({ queryKey: ['vendors-contracts', 'vendor-options'], queryFn: () => apiFetch<ContractVendorRef[]>('/api/v1/vendors/options') });
  const contractOptionsQuery = useQuery({ queryKey: ['vendors-contracts', 'contract-options'], queryFn: () => apiFetch<ContractOption[]>('/api/v1/contracts/options') });

  const items = useMemo(() => plansQuery.data?.items ?? [], [plansQuery.data]);
  const technicians = employeesQuery.data ?? [];
  const today = localDateKey();
  const upcomingLimit = localDateKey(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const plannedItems = plannedCountQuery.data?.items ?? [];
  const stats = {
    total: plansQuery.data?.pagination.totalItems ?? 0,
    upcoming: plannedItems.filter((plan) => plan.plan_date >= today && plan.plan_date <= upcomingLimit).length,
    overdue: plannedItems.filter((plan) => plan.plan_date < today).length,
    completed: completedCountQuery.data?.pagination.totalItems ?? 0,
  };
  const filteredItems = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('th');
    return items.filter((plan) => {
      const haystack = `${plan.asset?.asset_code ?? ''} ${plan.asset?.name ?? ''} ${employeeName(plan.technician)} ${plan.vendor?.name ?? ''}`.toLocaleLowerCase('th');
      return (!needle || haystack.includes(needle)) && (!status || plan.status === status) && (!recurrence || plan.recurrence === recurrence);
    });
  }, [items, recurrence, search, status]);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedItems = filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const clearFilters = () => table.setFilters({ search: '', status: '', recurrence: '' });
  const isFormReady = Boolean(assetsQuery.data && templatesQuery.data && vendorOptionsQuery.data && contractOptionsQuery.data);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">PM / บำรุงรักษา</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">วางแผน ติดตาม และบันทึกผลการบำรุงรักษาทรัพย์สิน IT</p></div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowAnalytics(true)} aria-haspopup="dialog"><BarChart3 className="h-4 w-4" /> วิเคราะห์ผล</Button>
          <RequirePermission permission="maintenance.manage"><Button size="sm" variant="outline" onClick={() => setShowTemplates(true)} aria-haspopup="dialog"><ListChecks className="h-4 w-4" /> เทมเพลต</Button></RequirePermission>
          <RequirePermission permission="maintenance.manage"><Button size="sm" onClick={() => setShowCreate(true)} data-testid="pm-create-toggle" aria-haspopup="dialog"><Plus className="h-4 w-4" /> เพิ่มแผน PM</Button></RequirePermission>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard icon={<Wrench className="h-5 w-5" />} label="แผนทั้งหมด" value={stats.total} tone="bg-primary-600" border="border-b-primary-500" />
        <SummaryCard icon={<CalendarClock className="h-5 w-5" />} label="ใกล้ถึงกำหนด (7 วัน)" value={stats.upcoming} tone="bg-slate-500" border="border-b-slate-400" />
        <SummaryCard icon={<CircleAlert className="h-5 w-5" />} label="เกินกำหนด" value={stats.overdue} tone="bg-amber-600" border="border-b-amber-500" />
        <SummaryCard icon={<CheckCircle2 className="h-5 w-5" />} label="ดำเนินการแล้ว" value={stats.completed} tone="bg-teal-700" border="border-b-teal-600" />
      </section>

      <section>
        <div className="flex border-b border-slate-200 dark:border-slate-700">
          <button type="button" onClick={() => table.setFilter('view', '')} className={cn('flex h-12 min-w-24 items-center justify-center gap-2 border-b-2 px-4 text-sm font-semibold transition', view === 'list' ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-slate-500 hover:text-slate-700')}><ListChecks className="h-4 w-4" /> รายการ</button>
          <button type="button" onClick={() => table.setFilter('view', 'calendar')} className={cn('flex h-12 min-w-24 items-center justify-center gap-2 border-b-2 px-4 text-sm font-semibold transition', view === 'calendar' ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-slate-500 hover:text-slate-700')}><CalendarDays className="h-4 w-4" /> ปฏิทิน</button>
          <button type="button" onClick={() => table.setFilter('view', 'roster')} className={cn('flex h-12 min-w-24 items-center justify-center gap-2 border-b-2 px-4 text-sm font-semibold transition', view === 'roster' ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-slate-500 hover:text-slate-700')}><UsersRound className="h-4 w-4" /> ตารางช่าง</button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-800">
        {view === 'list' ? (
          <>
            <div className="m-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40 lg:flex-row lg:items-center">
              <label className="flex h-10 min-w-0 flex-1 items-center rounded-lg border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900"><Search className="mx-3 h-4 w-4 shrink-0 text-slate-400" /><input type="search" aria-label="ค้นหาแผน PM" value={search} onChange={(event) => table.setFilter('search', event.target.value, { replace: true })} placeholder="ค้นหา Asset หรือผู้รับผิดชอบ..." className="min-w-0 flex-1 bg-transparent pr-3 text-sm outline-none" /></label>
              <select aria-label="กรองสถานะ" value={status} onChange={(event) => table.setFilter('status', event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 lg:w-44"><option value="">สถานะ: ทั้งหมด</option>{PM_STATUSES.map((value) => <option key={value}>{value}</option>)}</select>
              <select aria-label="กรองรอบทำซ้ำ" value={recurrence} onChange={(event) => table.setFilter('recurrence', event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900 lg:w-44"><option value="">รอบ: ทั้งหมด</option>{PM_RECURRENCES.map((value) => <option key={value}>{value}</option>)}</select>
              <Button size="sm" variant="outline" onClick={clearFilters}><RefreshCw className="h-4 w-4" /> ล้างตัวกรอง</Button>
              <Button size="sm" variant="outline" onClick={() => setShowExport(true)} aria-haspopup="dialog"><Download className="h-4 w-4" /> ส่งออก</Button>
              <span className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 dark:border-slate-600 dark:bg-slate-800">{filteredItems.length} รายการ</span>
            </div>

            {plansQuery.isLoading && <div className="grid min-h-64 place-items-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>}
            {plansQuery.isError && <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">โหลดรายการแผน PM ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</div>}
            {plansQuery.data && filteredItems.length === 0 && <EmptyState icon={<Wrench className="h-10 w-10" />} title="ยังไม่มีแผน PM" message="ลองเปลี่ยนตัวกรอง หรือเพิ่มแผน PM ใหม่" />}
            {plansQuery.data && filteredItems.length > 0 && (
              <div className="overflow-x-auto border-y border-slate-200 dark:border-slate-700">
                <DataTable mode="server" className="w-full min-w-[860px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold text-slate-600 dark:bg-slate-900/50 dark:text-slate-300"><tr><th className="w-16 px-4 py-3 text-center">ลำดับ</th><th className="px-4 py-3">Asset</th><th className="px-4 py-3">แผนวันที่</th><th className="px-4 py-3">รอบ</th><th className="px-4 py-3">ผู้รับผิดชอบ</th><th className="px-4 py-3">สถานะ</th><th className="w-20 px-4 py-3 text-center">Action</th></tr></thead>
                  <tbody>{pagedItems.map((plan, index) => <tr key={plan.id} data-testid={`pm-row-${plan.id}`} className="border-t border-slate-100 transition hover:bg-primary-50/40 dark:border-slate-700 dark:hover:bg-slate-700/40"><td className="px-4 py-3 text-center text-xs text-slate-400">{(currentPage - 1) * pageSize + index + 1}</td><td className="px-4 py-3"><p className="font-semibold text-slate-800 dark:text-slate-100">{plan.asset?.name ?? 'ไม่พบข้อมูล Asset'}</p><p className="mt-0.5 font-mono text-[11px] text-slate-400">{plan.asset?.asset_code ?? '—'}</p></td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatThaiDate(plan.plan_date, 'd MMM yyyy')}</td><td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300"><Repeat2 className="h-3.5 w-3.5 text-slate-400" />{plan.recurrence}</span></td><td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">{employeeName(plan.technician)}</td><td className="px-4 py-3"><Badge variant={statusTone[plan.status]}>{plan.status}</Badge></td><td className="px-4 py-3 text-center"><RowActions recordLabel={plan.asset?.name ?? plan.asset?.asset_code ?? plan.id} actions={[{ kind: 'custom', icon: MoreHorizontal, label: 'จัดการแผน', permission: 'maintenance.manage', onClick: () => setSelectedPlan(plan) }]} /></td></tr>)}</tbody>
                </DataTable>
              </div>
            )}
            <div className="px-4 pb-4"><TablePagination page={currentPage} pageSize={pageSize} totalItems={filteredItems.length} totalPages={pageCount} onPageChange={table.setPage} onPageSizeChange={table.setPageSize} /></div>
          </>
        ) : view === 'calendar' ? (
          <div className="overflow-x-auto"><CalendarView plans={items} month={calendarMonth} onMonthChange={setCalendarMonth} onSelect={setSelectedPlan} /></div>
        ) : <PmRosterView />}
      </section>

      {showCreate && <Modal title="เพิ่มแผน PM" size="lg" onClose={() => setShowCreate(false)} testId="pm-create-dialog">{isFormReady ? <CreatePlanForm assets={assetsQuery.data ?? []} technicians={technicians} templates={templatesQuery.data ?? []} vendors={vendorOptionsQuery.data ?? []} contracts={contractOptionsQuery.data ?? []} onClose={() => setShowCreate(false)} onSaved={() => setToast({ tone: 'success', message: 'เพิ่มแผน PM สำเร็จ' })} /> : <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-slate-500" role="status"><Loader2 className="h-5 w-5 animate-spin" /> กำลังเตรียมแบบฟอร์ม...</div>}</Modal>}
      {selectedPlan && <Modal title="จัดการแผน PM" size="lg" onClose={() => setSelectedPlan(null)} testId={`pm-action-dialog-${selectedPlan.id}`}><PlanActions plan={selectedPlan} technicians={technicians} onClose={() => setSelectedPlan(null)} onSaved={(message) => setToast({ tone: 'success', message })} /></Modal>}
      {showTemplates && <Modal title="เทมเพลตเช็กลิสต์ PM" size="lg" onClose={() => setShowTemplates(false)} testId="pm-template-dialog">{templatesAdminQuery.data ? <TemplateManager templates={templatesAdminQuery.data} onSaved={(message) => setToast({ tone: 'success', message })} /> : <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-slate-500" role="status"><Loader2 className="h-5 w-5 animate-spin" /> กำลังโหลดเทมเพลต...</div>}</Modal>}
      {showAnalytics && <Modal title="วิเคราะห์ผล PM" size="md" onClose={() => setShowAnalytics(false)} testId="pm-analytics-dialog"><AnalyticsPanel plans={items} /></Modal>}
      {showExport && <Modal title="ส่งออกรายการ PM" size="sm" onClose={() => setShowExport(false)} testId="pm-export-dialog"><ExportPanel plans={filteredItems} onClose={() => setShowExport(false)} /></Modal>}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
