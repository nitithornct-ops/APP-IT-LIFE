import { DataTable } from '../../components/table/DataTable';
import { RowActions } from '../../components/table/RowActions';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock,
  CircleSlash2,
  ClipboardCheck,
  ClipboardList,
  Download,
  Edit3,
  Folder,
  Grid3X3,
  Loader2,
  Package,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormModal } from '../../components/ui/Modal';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import { downloadCsv } from '../../utils/csv';
import { useAuth } from '../../stores/authContext';
import type { ApprovalGroup, Department, PaginatedResult } from '../../types/admin';
import type { ServiceCatalogItem, ServiceCatalogStatus } from '../../types/serviceCatalog';
import type { ServiceRequestListItem, ServiceRequestStatus } from '../../types/serviceRequests';
import { formatThaiDate } from '../../utils/date';

type WorkspaceTab = 'catalog' | 'mine' | 'action' | 'all' | 'manage';

const requestStatusTone: Record<ServiceRequestStatus, 'secondary' | 'info' | 'warning' | 'success' | 'danger' | 'primary'> = {
  รออนุมัติ: 'warning',
  รอมอบหมาย: 'info',
  กำลังดำเนินการ: 'primary',
  รอผู้ใช้งาน: 'warning',
  รอผู้ให้บริการ: 'warning',
  รอยืนยันผล: 'warning',
  ปิดงาน: 'success',
  ปฏิเสธ: 'danger',
  ยกเลิก: 'secondary',
};

const catalogStatusLabel: Record<ServiceCatalogStatus, string> = {
  draft: 'ร่าง',
  active: 'ใช้งาน',
  suspended: 'ระงับ',
  retired: 'ยกเลิก',
};

const catalogStatusTone: Record<ServiceCatalogStatus, 'secondary' | 'success' | 'warning' | 'danger'> = {
  draft: 'secondary',
  active: 'success',
  suspended: 'warning',
  retired: 'danger',
};

const openRequestStatuses = new Set<ServiceRequestStatus>([
  'รออนุมัติ',
  'รอมอบหมาย',
  'กำลังดำเนินการ',
  'รอผู้ใช้งาน',
  'รอผู้ให้บริการ',
  'รอยืนยันผล',
]);

const fieldClass =
  'mt-1 min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-primary-900/30';
const labelClass = 'block text-sm font-semibold text-slate-700 dark:text-slate-200';

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function StatCard({ icon, value, label, tone }: { icon: React.ReactNode; value: number; label: string; tone: 'blue' | 'slate' | 'teal' }) {
  const toneClass =
    tone === 'blue'
      ? 'bg-blue-600 text-white border-blue-500'
      : tone === 'teal'
        ? 'bg-teal-700 text-white border-teal-500'
        : 'bg-slate-500 text-white border-slate-400';
  const bottomClass = tone === 'blue' ? 'bg-blue-600' : tone === 'teal' ? 'bg-teal-500' : 'bg-slate-400';
  return (
    <div className="relative flex min-h-[102px] items-center gap-4 overflow-hidden rounded-2xl border border-slate-200 bg-white px-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${toneClass}`}>{icon}</span>
      <div>
        <p className="text-2xl font-extrabold leading-none text-slate-900 dark:text-white">{value}</p>
        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      </div>
      <span className={`absolute inset-x-0 bottom-0 h-0.5 ${bottomClass}`} />
    </div>
  );
}

const requestSchema = z.object({
  summary: z.string().trim().optional(),
  requestedFor: z.string().trim().optional(),
  businessJustification: z.string().trim().optional(),
  priority: z.enum(['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต']),
});
type RequestFormValues = z.infer<typeof requestSchema>;

function RequestDialog({ item, onClose }: { item: ServiceCatalogItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [attachment, setAttachment] = useState<File | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const { register, handleSubmit, formState: { errors } } = useForm<RequestFormValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { summary: item.service_name, priority: 'ปานกลาง' },
  });
  const mutation = useMutation({
    mutationFn: async (values: RequestFormValues) => {
      if (item.attachment_required && !attachment) {
        throw new ApiError('SERVICE_REQUEST_ATTACHMENT_REQUIRED', 'บริการนี้บังคับแนบเอกสาร');
      }
      if (attachment && attachment.size > 10 * 1024 * 1024) {
        throw new ApiError('FILE_TOO_LARGE', 'ไฟล์ต้องมีขนาดไม่เกิน 10 MB');
      }
      const request = await apiFetch<{ id: string }>('/api/v1/service-requests', {
        method: 'POST',
        body: JSON.stringify({ catalogId: item.id, ...values, answers, idempotencyKey }),
      });
      if (attachment) {
        const data = new FormData();
        data.append('file', attachment);
        data.append('module', 'service_request');
        data.append('targetTable', 'service_requests');
        data.append('targetId', request.id);
        await apiFetch('/api/v1/files', { method: 'POST', body: data });
      }
      return request;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-requests'] });
      onClose();
    },
    onError: (error) => setServerError(errorText(error, 'ยื่นคำขอไม่สำเร็จ')),
  });
  const formFields = Array.isArray(item.form_schema) ? item.form_schema as Array<Record<string, unknown>> : [];

  return (
    <FormModal closeTestId="service-request-close" title={`ขอรับบริการ: ${item.service_name}`} description={`${item.service_code} · SLA ${item.sla_hours} ชั่วโมง · ${item.approval_mode === 'none' ? 'ไม่ต้องอนุมัติ' : 'ต้องผ่านการอนุมัติ'}`} size="md" closeDisabled={mutation.isPending} onClose={onClose}>
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate>
        <div className="space-y-4 p-5">
          <label className={labelClass}>หัวข้อคำขอ<input className={fieldClass} {...register('summary')} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>ขอให้ใคร (เว้นว่างหากขอให้ตนเอง)<input className={fieldClass} {...register('requestedFor')} /></label>
            <label className={labelClass}>ความเร่งด่วน<select className={fieldClass} {...register('priority')}><option>ต่ำ</option><option>ปานกลาง</option><option>สูง</option><option>วิกฤต</option></select></label>
          </div>
          {formFields.map((field, index) => {
            const key = String(field.key ?? `field_${index}`);
            const label = String(field.label ?? key);
            const required = Boolean(field.required);
            if (field.type === 'textarea') return <label key={key} className={labelClass}>{label}{required && <span className="text-red-500"> *</span>}<textarea rows={3} className={`${fieldClass} py-3`} onChange={(event) => setAnswers((value) => ({ ...value, [key]: event.target.value }))} required={required} /></label>;
            if (field.type === 'select' && Array.isArray(field.options)) return <label key={key} className={labelClass}>{label}{required && <span className="text-red-500"> *</span>}<select className={fieldClass} onChange={(event) => setAnswers((value) => ({ ...value, [key]: event.target.value }))} required={required}><option value="">— เลือก —</option>{field.options.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select></label>;
            if (field.type === 'checkbox') return <label key={key} className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" className="h-4 w-4 rounded" onChange={(event) => setAnswers((value) => ({ ...value, [key]: event.target.checked }))} />{label}</label>;
            return <label key={key} className={labelClass}>{label}{required && <span className="text-red-500"> *</span>}<input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} className={fieldClass} onChange={(event) => setAnswers((value) => ({ ...value, [key]: event.target.value }))} required={required} /></label>;
          })}
          <label className={labelClass}>เหตุผล / รายละเอียดเพิ่มเติม<textarea rows={3} className={`${fieldClass} py-3`} {...register('businessJustification')} /></label>
          <label className={labelClass}>
            ไฟล์แนบ {item.attachment_required && <span className="text-red-500">*</span>}
            <input
              type="file"
              className={`${fieldClass} py-2`}
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.txt"
              onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
            />
            <span className="mt-1 block text-xs font-normal text-slate-400">PDF, รูปภาพ, Office หรือ TXT ไม่เกิน 10 MB</span>
          </label>
          {item.attachment_required && <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><Paperclip className="h-4 w-4" />ต้องแนบเอกสารก่อนยื่นคำขอและก่อนอนุมัติ/เริ่มดำเนินการ</div>}
          {errors.priority && <p className="text-sm text-red-600">{errors.priority.message}</p>}
          {serverError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{serverError}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/40">
          <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button type="submit" isLoading={mutation.isPending}><Send className="h-4 w-4" />ยื่นคำขอ</Button>
        </div>
      </form>
    </FormModal>
  );
}

const catalogSchema = z.object({
  serviceCode: z.string().trim().min(1, 'กรุณาระบุรหัสบริการ').regex(/^[A-Za-z0-9_-]+$/, 'ใช้ได้เฉพาะ A-Z, 0-9, _ และ -'),
  serviceName: z.string().trim().min(1, 'กรุณาระบุชื่อบริการ'),
  category: z.string().trim().optional(),
  description: z.string().trim().optional(),
  eligibilityText: z.string().trim().optional(),
  slaHours: z.coerce.number().positive('SLA ต้องมากกว่า 0').max(720),
  attachmentRequired: z.boolean(),
  approvalMode: z.enum(['none', 'group']),
  approvalGroupId: z.string().optional(),
  fulfillmentGroupId: z.string().optional(),
  closeMode: z.enum(['requester_confirms', 'it_closes']),
  formSchemaText: z.string(),
  checklistText: z.string(),
}).refine((value) => value.approvalMode !== 'group' || Boolean(value.approvalGroupId), { message: 'กรุณาเลือกกลุ่มอนุมัติ', path: ['approvalGroupId'] });
type CatalogFormValues = z.infer<typeof catalogSchema>;

function parseJsonArray(value: string, label: string) {
  try {
    const parsed: unknown = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} ต้องเป็น JSON Array ที่ถูกต้อง`);
  }
}

function eligibilityToText(value: ServiceCatalogItem['eligibility']) {
  if (!value) return 'ทั้งหมด';
  return (value.roles ?? []).join(', ');
}

function CatalogEditor({ item, approvalGroups, departments, onClose }: { item?: ServiceCatalogItem; approvalGroups: ApprovalGroup[]; departments: Department[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, watch, formState: { errors } } = useForm<CatalogFormValues>({
    resolver: zodResolver(catalogSchema),
    defaultValues: item ? {
      serviceCode: item.service_code,
      serviceName: item.service_name,
      category: item.category ?? '',
      description: item.description ?? '',
      eligibilityText: eligibilityToText(item.eligibility),
      slaHours: item.sla_hours,
      attachmentRequired: item.attachment_required,
      approvalMode: item.approval_mode,
      approvalGroupId: item.approval_group_id ?? '',
      fulfillmentGroupId: item.fulfillment_group_id ?? '',
      closeMode: item.close_mode,
      formSchemaText: JSON.stringify(item.form_schema ?? [], null, 2),
      checklistText: JSON.stringify(item.checklist ?? [], null, 2),
    } : {
      eligibilityText: 'ทั้งหมด', slaHours: 24, attachmentRequired: false, approvalMode: 'none', approvalGroupId: '', fulfillmentGroupId: '', closeMode: 'requester_confirms', formSchemaText: '[]', checklistText: '[]',
    },
  });
  const approvalMode = watch('approvalMode');
  const mutation = useMutation({
    mutationFn: (values: CatalogFormValues) => {
      const eligibilityText = values.eligibilityText?.trim();
      const payload = {
        serviceCode: values.serviceCode.toUpperCase(),
        serviceName: values.serviceName,
        category: values.category || undefined,
        description: values.description || undefined,
        eligibility: !eligibilityText || eligibilityText === 'ทั้งหมด' ? null : { roles: eligibilityText.split(',').map((part) => part.trim()).filter(Boolean) },
        slaHours: values.slaHours,
        attachmentRequired: values.attachmentRequired,
        approvalMode: values.approvalMode,
        approvalGroupId: values.approvalMode === 'group' ? values.approvalGroupId : undefined,
        fulfillmentGroupId: values.fulfillmentGroupId || undefined,
        closeMode: values.closeMode,
        formSchema: parseJsonArray(values.formSchemaText, 'ฟิลด์แบบฟอร์ม'),
        checklist: parseJsonArray(values.checklistText, 'Checklist'),
      };
      return apiFetch(item ? `/api/v1/service-catalog/${item.id}` : '/api/v1/service-catalog', { method: item ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['service-catalog'] }); onClose(); },
    onError: (error) => setServerError(errorText(error, error instanceof Error ? error.message : 'บันทึกบริการไม่สำเร็จ')),
  });

  return (
    <FormModal title={item ? 'แก้ไขรายการบริการ' : 'เพิ่มรายการบริการ'} description="กำหนด SLA สิทธิ์ แบบอนุมัติ และโครงสร้างฟอร์ม" size="xl" closeDisabled={mutation.isPending} onClose={onClose}>
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate>
        <div className="p-5">
          <div className="grid gap-x-5 gap-y-4 md:grid-cols-6">
            <label className={`${labelClass} md:col-span-2`}>รหัสบริการ <span className="text-red-500">*</span><input className={fieldClass} {...register('serviceCode')} /><span className="mt-1 block text-xs font-normal text-slate-400">A-Z, 0-9, _ และ -</span>{errors.serviceCode && <span className="mt-1 block text-xs text-red-600">{errors.serviceCode.message}</span>}</label>
            <label className={`${labelClass} md:col-span-2`}>ชื่อบริการ <span className="text-red-500">*</span><input className={fieldClass} {...register('serviceName')} />{errors.serviceName && <span className="mt-1 block text-xs text-red-600">{errors.serviceName.message}</span>}</label>
            <label className={`${labelClass} md:col-span-2`}>หมวดบริการ<input className={fieldClass} {...register('category')} /></label>
            <label className={`${labelClass} md:col-span-6`}>คำอธิบาย<textarea rows={3} className={`${fieldClass} py-3`} {...register('description')} /></label>
            <label className={`${labelClass} md:col-span-3`}>ผู้มีสิทธิ์ขอ<input className={fieldClass} {...register('eligibilityText')} /><span className="mt-1 block text-xs font-normal text-slate-400">ทั้งหมด หรือ role หลายค่า คั่นด้วย comma</span></label>
            <label className={`${labelClass} md:col-span-2`}>SLA (ชั่วโมงทำการ) <span className="text-red-500">*</span><input type="number" min={1} max={720} className={fieldClass} {...register('slaHours')} />{errors.slaHours && <span className="mt-1 block text-xs text-red-600">{errors.slaHours.message}</span>}</label>
            <label className="flex items-center gap-2 self-center text-sm font-semibold text-slate-700 dark:text-slate-200"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...register('attachmentRequired')} />บังคับแนบเอกสาร</label>
            <label className={`${labelClass} md:col-span-2`}>รูปแบบอนุมัติ<select className={fieldClass} {...register('approvalMode')}><option value="none">ไม่ต้องอนุมัติ</option><option value="group">กลุ่มอนุมัติ</option></select></label>
            <label className={`${labelClass} md:col-span-2`}>กลุ่มผู้อนุมัติ{approvalMode === 'group' && <span className="text-red-500"> *</span>}<select className={fieldClass} disabled={approvalMode !== 'group'} {...register('approvalGroupId')}><option value="">— เลือกกลุ่มอนุมัติ —</option>{approvalGroups.map((group) => <option key={group.id} value={group.id}>{group.name} ({group.code})</option>)}</select>{errors.approvalGroupId && <span className="mt-1 block text-xs text-red-600">{errors.approvalGroupId.message}</span>}</label>
            <label className={`${labelClass} md:col-span-2`}>กลุ่มดำเนินการ<select className={fieldClass} {...register('fulfillmentGroupId')}><option value="">— ไม่ระบุ —</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name_th}</option>)}</select></label>
            <label className={`${labelClass} md:col-span-3`}>Workflow Definition กลาง<select className={fieldClass} disabled><option>ไม่ใช้ Workflow Definition กลาง</option></select><span className="mt-1 block text-xs font-normal text-slate-400">สร้าง/แก้ไข Definition ได้จากเมนู Workflow</span></label>
            <label className={`${labelClass} md:col-span-3`}>รูปแบบปิดงาน<select className={fieldClass} {...register('closeMode')}><option value="requester_confirms">ผู้ขอยืนยันผลก่อนปิดงาน</option><option value="it_closes">IT ปิดงานโดยตรง</option></select></label>
            <label className={`${labelClass} md:col-span-3`}>ฟิลด์แบบฟอร์ม (JSON)<textarea rows={5} className={`${fieldClass} py-3 font-mono text-xs`} {...register('formSchemaText')} /><span className="mt-1 block text-xs font-normal text-slate-400">รองรับ text, textarea, number, date, select และ checkbox</span></label>
            <label className={`${labelClass} md:col-span-3`}>Checklist (JSON)<textarea rows={5} className={`${fieldClass} py-3 font-mono text-xs`} {...register('checklistText')} /><span className="mt-1 block text-xs font-normal text-slate-400">ตัวอย่าง: [{'{'}&quot;name&quot;:&quot;ตรวจสอบข้อมูล&quot;{'}'}]</span></label>
            {serverError && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 md:col-span-6">{serverError}</p>}
          </div>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-700 dark:bg-slate-900">
          <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button type="submit" isLoading={mutation.isPending}>{item ? 'บันทึกการแก้ไข' : 'สร้าง Catalog'}</Button>
        </div>
      </form>
    </FormModal>
  );
}

function CatalogCards({ items, canRequest, onRequest }: { items: ServiceCatalogItem[]; canRequest: boolean; onRequest: (item: ServiceCatalogItem) => void }) {
  const grouped = useMemo(() => {
    const result = new Map<string, ServiceCatalogItem[]>();
    items.forEach((item) => {
      const category = item.category?.trim() || 'บริการทั่วไป';
      result.set(category, [...(result.get(category) ?? []), item]);
    });
    return [...result.entries()].sort(([a], [b]) => a.localeCompare(b, 'th'));
  }, [items]);
  if (!items.length) return <EmptyState icon={<Package className="h-10 w-10" />} title="ยังไม่มีบริการที่เปิดให้ขอ" description="ติดต่อผู้ดูแลระบบเพื่อเปิดใช้งาน Service Catalog" />;
  return <div className="space-y-6">{grouped.map(([category, categoryItems]) => <section key={category}><h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-slate-900 dark:text-white"><Folder className="h-5 w-5 text-primary-600" />{category}</h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{categoryItems.map((item) => <article key={item.id} className="flex min-h-[205px] flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-800"><div className="flex items-center gap-2 text-xs font-medium text-slate-500"><Package className="h-4 w-4" />{item.service_code}</div><h3 className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">{item.service_name}</h3><p className="mt-2 line-clamp-2 flex-1 text-sm text-slate-500 dark:text-slate-400">{item.description || 'ไม่มีคำอธิบายเพิ่มเติม'}</p><div className="mb-3 mt-3 flex flex-wrap gap-2 text-[11px]"><span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-700"><AlarmClock className="mr-1 inline h-3 w-3" />SLA {item.sla_hours} ชม.</span><span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-700"><ShieldCheck className="mr-1 inline h-3 w-3" />{item.approval_mode === 'none' ? 'ไม่ต้องอนุมัติ' : 'ต้องอนุมัติ'}</span><span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-700"><ClipboardCheck className="mr-1 inline h-3 w-3" />{item.checklist.length} ข้อ</span></div>{canRequest && <Button className="w-full" onClick={() => onRequest(item)}><Send className="h-4 w-4" />ขอรับบริการ</Button>}</article>)}</div></section>)}</div>;
}

function RequestTable({ items }: { items: ServiceRequestListItem[] }) {
  if (!items.length) return <EmptyState icon={<ClipboardList className="h-10 w-10" />} title="ไม่พบคำขอบริการ" description="รายการที่ตรงกับเงื่อนไขจะแสดงที่นี่" />;
  return <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"><DataTable className="w-full min-w-[840px] text-left text-sm"><thead className="bg-slate-50 text-xs font-bold text-slate-600 dark:bg-slate-900/50 dark:text-slate-300"><tr><th className="px-4 py-3">รหัส</th><th className="px-4 py-3">บริการ</th><th className="px-4 py-3">ความเร่งด่วน</th><th className="px-4 py-3">สถานะ</th><th className="px-4 py-3">ครบกำหนด</th><th className="px-4 py-3">ยื่นเมื่อ</th><th className="px-4 py-3 text-right">ดำเนินการ</th></tr></thead><tbody>{items.map((request) => <tr key={request.id} className="border-t border-slate-100 dark:border-slate-700"><td className="px-4 py-3 font-mono text-xs text-slate-500">{request.service_code}</td><td className="px-4 py-3"><Link to={`/service-requests/${request.id}`} className="font-bold text-primary-700 hover:underline dark:text-primary-300">{request.service_name}</Link></td><td className="px-4 py-3"><Badge variant="secondary">{request.priority}</Badge></td><td className="px-4 py-3"><Badge variant={requestStatusTone[request.status]}>{request.status}</Badge></td><td className="px-4 py-3 text-slate-500">{request.due_at ? formatThaiDate(request.due_at, 'd MMM yyyy HH:mm') : '—'}</td><td className="px-4 py-3 text-slate-500">{formatThaiDate(request.created_at, 'd MMM yyyy HH:mm')}</td><td className="px-4 py-3 text-right"><RowActions recordLabel={request.service_code} actions={[{ kind: 'view', to: `/service-requests/${request.id}` }]} /></td></tr>)}</tbody></DataTable></div>;
}

function CatalogManagement({ items, onCreate, onEdit }: { items: ServiceCatalogItem[]; onCreate: () => void; onEdit: (item: ServiceCatalogItem) => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const categories = useMemo(() => [...new Set(items.map((item) => item.category).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'th')), [items]);
  const filtered = useMemo(() => items.filter((item) => {
    const term = search.trim().toLocaleLowerCase('th');
    return (!term || `${item.service_code} ${item.service_name} ${item.category ?? ''}`.toLocaleLowerCase('th').includes(term)) && (!status || item.status === status) && (!category || item.category === category);
  }), [category, items, search, status]);
  const statusMutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: ServiceCatalogStatus }) => apiFetch(`/api/v1/service-catalog/${id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['service-catalog'] }),
  });
  function exportCsv() {
    const rows = [['รหัส', 'บริการ', 'หมวด', 'SLA', 'สถานะ'], ...filtered.map((item) => [item.service_code, item.service_name, item.category ?? '', String(item.sla_hours), catalogStatusLabel[item.status]])];
    downloadCsv(rows, 'service-catalog.csv');
  }
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
      <label className="relative min-w-[240px] flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหาในรายการ..." className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm outline-none focus:border-primary-500 dark:border-slate-600 dark:bg-slate-900" /></label>
      <select aria-label="กรองสถานะ" value={status} onChange={(event) => setStatus(event.target.value)} className="h-11 min-w-[150px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">สถานะ: ทั้งหมด</option>{(Object.keys(catalogStatusLabel) as ServiceCatalogStatus[]).map((value) => <option key={value} value={value}>{catalogStatusLabel[value]}</option>)}</select>
      <select aria-label="กรองหมวด" value={category} onChange={(event) => setCategory(event.target.value)} className="h-11 min-w-[150px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">หมวด: ทั้งหมด</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
      <div className="ml-auto flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setSearch(''); setStatus(''); setCategory(''); }}><RotateCcw className="h-4 w-4" />ล้างตัวกรอง</Button><Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4" />ส่งออก</Button><Button data-testid="catalog-manage-create" onClick={onCreate}><Plus className="h-4 w-4" />เพิ่มบริการ</Button></div>
    </div>
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700"><DataTable className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50 text-xs font-bold text-slate-700 dark:bg-slate-900/50 dark:text-slate-300"><tr><th className="px-4 py-3">ลำดับ</th><th className="px-4 py-3">รหัส</th><th className="px-4 py-3">บริการ</th><th className="px-4 py-3">Workflow</th><th className="px-4 py-3">SLA</th><th className="px-4 py-3">สถานะ</th><th className="px-4 py-3">จัดการ</th></tr></thead><tbody>{filtered.map((item, index) => <tr key={item.id} className="border-t border-slate-100 dark:border-slate-700"><td className="px-4 py-3 text-slate-500">{index + 1}</td><td className="px-4 py-3"><p className="font-bold text-slate-700 dark:text-slate-200">{item.service_code}</p><p className="text-xs text-slate-400">v{item.version}</p></td><td className="px-4 py-3"><p className="font-bold text-slate-800 dark:text-white">{item.service_name}</p><p className="text-xs text-slate-400">{item.category || 'บริการทั่วไป'}</p></td><td className="px-4 py-3"><p>{item.approval_mode === 'none' ? 'ไม่ต้องอนุมัติ' : 'กลุ่มอนุมัติ'}</p><p className="text-xs text-slate-400">ปิด: {item.close_mode === 'requester_confirms' ? 'ผู้ขอยืนยัน' : 'IT'}</p></td><td className="px-4 py-3">{item.sla_hours} ชม.</td><td className="px-4 py-3"><Badge variant={catalogStatusTone[item.status]}>{catalogStatusLabel[item.status]}</Badge></td><td className="px-4 py-3"><div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => onEdit(item)}><Edit3 className="h-3.5 w-3.5" />แก้ไข</Button>{item.status === 'active' ? <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: item.id, nextStatus: 'suspended' })}>ระงับ</Button> : item.status !== 'retired' && <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: item.id, nextStatus: 'active' })}>เปิดใช้</Button>}{item.status !== 'retired' && <Button size="sm" variant="danger" onClick={() => statusMutation.mutate({ id: item.id, nextStatus: 'retired' })}>ยกเลิก</Button>}</div></td></tr>)}</tbody></DataTable>{!filtered.length && <div className="py-10 text-center text-sm text-slate-500">ไม่พบรายการที่ตรงกับตัวกรอง</div>}</div>
  </div>;
}

export function ServiceRequestsPage({ initialTab = 'catalog' }: { initialTab?: WorkspaceTab }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('service_catalog.manage');
  const canRequest = hasPermission('service_request.create');
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [requestItem, setRequestItem] = useState<ServiceCatalogItem>();
  const [editingItem, setEditingItem] = useState<ServiceCatalogItem | null>();
  const [showEditor, setShowEditor] = useState(false);

  const catalogQuery = useQuery({ queryKey: ['service-catalog', canManage ? 'all' : 'active'], queryFn: () => apiFetch<PaginatedResult<ServiceCatalogItem>>('/api/v1/service-catalog?pageSize=100') });
  const mineQuery = useQuery({ queryKey: ['service-requests', 'mine'], queryFn: () => apiFetch<PaginatedResult<ServiceRequestListItem>>('/api/v1/service-requests?pageSize=100&mine=true') });
  const visibleQuery = useQuery({ queryKey: ['service-requests', 'visible'], queryFn: () => apiFetch<PaginatedResult<ServiceRequestListItem>>('/api/v1/service-requests?pageSize=100') });
  const approvalsQuery = useQuery({ queryKey: ['service-requests', 'pending-my-approval'], queryFn: () => apiFetch<PaginatedResult<ServiceRequestListItem>>('/api/v1/service-requests?pageSize=100&pendingMyApproval=true') });
  const approvalGroupsQuery = useQuery({ queryKey: ['admin', 'approval-groups'], enabled: canManage && showEditor, queryFn: () => apiFetch<ApprovalGroup[]>('/api/v1/approval-groups') });
  const departmentsQuery = useQuery({ queryKey: ['admin', 'departments'], enabled: canManage && showEditor, queryFn: () => apiFetch<Department[]>('/api/v1/departments') });

  const catalogItems = catalogQuery.data?.items ?? [];
  const activeCatalog = catalogItems.filter((item) => item.status === 'active');
  const mineItems = mineQuery.data?.items ?? [];
  const visibleItems = visibleQuery.data?.items ?? [];
  const approvalItems = approvalsQuery.data?.items ?? [];
  const openMine = mineItems.filter((item) => openRequestStatuses.has(item.status)).length;
  const overdue = visibleItems.filter((item) => item.due_at && openRequestStatuses.has(item.status) && new Date(item.due_at).getTime() < Date.now()).length;
  const tabs: Array<{ key: WorkspaceTab; label: string; count?: number; show: boolean }> = [
    { key: 'catalog', label: 'รายการบริการ', count: activeCatalog.length, show: true },
    { key: 'mine', label: 'คำขอของฉัน', count: mineItems.length, show: true },
    { key: 'action', label: 'คิวดำเนินการ', count: approvalItems.length, show: true },
    { key: 'all', label: 'คำขอทั้งหมด', count: visibleItems.length, show: true },
    { key: 'manage', label: 'จัดการ Catalog', show: canManage },
  ];
  const loading = catalogQuery.isLoading || mineQuery.isLoading || visibleQuery.isLoading || approvalsQuery.isLoading;
  const failed = catalogQuery.isError || mineQuery.isError || visibleQuery.isError || approvalsQuery.isError;

  if (loading) return <div className="flex justify-center py-24" role="status"><Loader2 className="h-7 w-7 animate-spin text-primary-600" /></div>;
  if (failed) return <EmptyState icon={<CircleSlash2 className="h-9 w-9" />} title="โหลด Service Catalog ไม่สำเร็จ" description="กรุณาลองใหม่อีกครั้ง" />;

  return <div className="space-y-6" data-testid="service-catalog-workspace">
    <div className="flex flex-wrap items-start justify-between gap-3"><PageTitle eyebrow="บริการและกระบวนการ IT / คำขอบริการ" title={<><Grid3X3 className="h-6 w-6 text-primary-600" />Service Catalog / คำขอบริการ</>} description="เลือกบริการ ยื่นคำขอ ติดตามการอนุมัติ Checklist และ SLA ในกระบวนการเดียว" />{canManage && <Button data-testid="catalog-header-create" onClick={() => { setEditingItem(null); setShowEditor(true); }}><Plus className="h-4 w-4" />เพิ่มบริการ</Button>}</div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><StatCard icon={<Grid3X3 className="h-6 w-6" />} value={activeCatalog.length} label="บริการที่เลือกได้" tone="blue" /><StatCard icon={<Users className="h-6 w-6" />} value={openMine} label="คำขอของฉันที่เปิดอยู่" tone="slate" /><StatCard icon={<ClipboardCheck className="h-6 w-6" />} value={approvalItems.length} label="รอฉันอนุมัติ" tone="slate" /><StatCard icon={<AlarmClock className="h-6 w-6" />} value={overdue} label="คิวเกิน SLA" tone="teal" /></div>
    <div className="flex gap-2 overflow-x-auto border-b border-slate-200 dark:border-slate-700">{tabs.filter((item) => item.show).map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`whitespace-nowrap border-b-[3px] px-5 py-3 text-sm font-bold transition ${tab === item.key ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>{item.label}{item.count !== undefined && ` (${item.count})`}</button>)}</div>
    {tab === 'catalog' && <CatalogCards items={activeCatalog} canRequest={canRequest} onRequest={setRequestItem} />}
    {tab === 'mine' && <RequestTable items={mineItems} />}
    {tab === 'action' && <RequestTable items={approvalItems} />}
    {tab === 'all' && <RequestTable items={visibleItems} />}
    {tab === 'manage' && canManage && <CatalogManagement items={catalogItems} onCreate={() => { setEditingItem(null); setShowEditor(true); }} onEdit={(item) => { setEditingItem(item); setShowEditor(true); }} />}
    {requestItem && <RequestDialog item={requestItem} onClose={() => setRequestItem(undefined)} />}
    {showEditor && approvalGroupsQuery.data && departmentsQuery.data && <CatalogEditor item={editingItem ?? undefined} approvalGroups={approvalGroupsQuery.data} departments={departmentsQuery.data} onClose={() => { setShowEditor(false); setEditingItem(null); }} />}
  </div>;
}
