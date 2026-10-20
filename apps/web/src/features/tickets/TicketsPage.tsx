import { DataTable, TablePagination } from '../../components/table/DataTable';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  Clock3,
  FileText,
  Plus,
  ShieldAlert,
  Star,
  Tags,
  Ticket as TicketIcon,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTableParams } from '../../hooks/useTableParams';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { BulkActionModal, BulkResultSummary, bulkFieldClass, bulkTextareaClass, type BulkResult } from '../../components/table/BulkAction';
import { ExportAllButton } from '../../components/table/ExportAllButton';
import { RowActions } from '../../components/table/RowActions';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { FilterBar, filterControlClass } from '../../components/ui/FilterBar';
import { KpiStrip } from '../../components/ui/KpiStrip';
import { LoadingState } from '../../components/ui/AsyncState';
import { PageHeader } from '../../components/ui/PageHeader';
import { QueryError } from '../../components/ui/QueryError';
import { FormModal, Modal } from '../../components/ui/Modal';
import { SlaBadge } from '../../components/ui/SlaBadge';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useAuth } from '../../stores/authContext';
import { ApiError, apiFetch, showToast } from '../../services/apiClient';
import type { Department, Position, TicketCategory } from '../../types/admin';
import type { PaginatedResult } from '../../types/admin';
import type { AssetOption } from '../../types/assets';
import type { AssignableStaff, TicketListItem, TicketPriority, TicketQueueSummary, TicketStatus } from '../../types/tickets';
import { formatThaiDate } from '../../utils/date';
import { cn } from '../../utils/cn';
import { LOCKED_TICKET_STATUSES, ticketPriorityTone as priorityTone, ticketSlaBadge, ticketStatusLabel, ticketStatusTone } from './ticketDisplay';
import './tickets.css';

const TICKET_STATUSES: TicketStatus[] = [
  'ใหม่',
  'รับเรื่องแล้ว',
  'กำลังดำเนินการ',
  'รออะไหล่',
  'รอผู้ใช้งาน',
  'ส่งต่อ Outsource',
  'เสร็จสิ้น',
  'ปิดงาน',
  'ยกเลิก',
  'ยกระดับเป็น Incident',
];

const TICKET_PRIORITIES: TicketPriority[] = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'];

const priorityRowClass: Record<TicketPriority, string> = {
  ต่ำ: 'shadow-[inset_3px_0_0_#94a3b8]',
  ปานกลาง: 'shadow-[inset_3px_0_0_#2454a6]',
  สูง: 'shadow-[inset_3px_0_0_#d97706]',
  วิกฤต: 'shadow-[inset_3px_0_0_#dc2626]',
};

/** สถานะที่เปลี่ยนทีละหลายใบได้ — ต้องตรงกับ BULK_TICKET_STATUSES ฝั่ง api */
const BULK_STATUSES: TicketStatus[] = ['รับเรื่องแล้ว', 'กำลังดำเนินการ'];

type TicketBulkResult = BulkResult<{ id: string; ticketNo: string; status: string }>;

/**
 * แผงดำเนินการกับ Ticket ที่เลือกไว้หลายใบ
 * ตั้งใจให้เลือกได้ทีละอย่าง (มอบหมาย หรือ เปลี่ยนสถานะ) เพื่อให้ worklog อ่านแล้วรู้ว่าเกิดอะไรขึ้น
 */
function BulkTicketPanel({
  ids,
  staff,
  onClose,
  onDone,
}: {
  ids: string[];
  staff: AssignableStaff[];
  onClose: () => void;
  onDone: (result: TicketBulkResult) => void;
}) {
  const [action, setAction] = useState<'assign' | 'status'>('assign');
  const [assigneeId, setAssigneeId] = useState('');
  const [status, setStatus] = useState<TicketStatus>('กำลังดำเนินการ');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiFetch<TicketBulkResult>('/api/v1/tickets/bulk', {
      method: 'PATCH',
      body: JSON.stringify({
        ids,
        note: note.trim() || undefined,
        ...(action === 'assign' ? { assigneeId: assigneeId || null } : { status }),
      }),
    }),
    onSuccess: onDone,
    onError: (mutationError) => setError(mutationError instanceof ApiError ? mutationError.message : 'ดำเนินการไม่สำเร็จ'),
  });

  return (
    <BulkActionModal
      count={ids.length}
      itemLabel="ใบงาน"
      isPending={mutation.isPending}
      error={error}
      onClose={onClose}
      onSubmit={() => { setError(null); mutation.mutate(); }}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {([['assign', 'มอบหมายผู้รับผิดชอบ'], ['status', 'เปลี่ยนสถานะ']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setAction(value)}
              className={`h-9 rounded-lg px-3 text-sm font-semibold ${action === value ? 'bg-primary-600 text-white' : 'border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {action === 'assign' ? (
          <label className="block text-sm">
            <span className="font-semibold text-slate-700 dark:text-slate-200">ผู้รับผิดชอบ</span>
            <select
              aria-label="ผู้รับผิดชอบ"
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              className={bulkFieldClass}
            >
              <option value="">ไม่มีผู้รับผิดชอบ</option>
              {staff.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
            </select>
          </label>
        ) : (
          <label className="block text-sm">
            <span className="font-semibold text-slate-700 dark:text-slate-200">สถานะใหม่</span>
            <select
              aria-label="สถานะใหม่"
              value={status}
              onChange={(event) => setStatus(event.target.value as TicketStatus)}
              className={bulkFieldClass}
            >
              {BULK_STATUSES.map((item) => <option key={item} value={item}>{ticketStatusLabel[item]}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              การปิดงาน ยกเลิก ส่งต่อ Outsource และยกระดับเป็น Incident ต้องทำทีละใบ เพราะแต่ละใบต้องระบุข้อมูลของตัวเอง
            </p>
          </label>
        )}

        <label className="block text-sm">
          <span className="font-semibold text-slate-700 dark:text-slate-200">บันทึกการดำเนินงาน (ไม่บังคับ)</span>
          <textarea
            aria-label="บันทึกการดำเนินงาน"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            rows={3}
            className={bulkTextareaClass}
          />
        </label>
      </div>
    </BulkActionModal>
  );
}

function requesterName(ticket: TicketListItem): string {
  return ticket.requester?.full_name ?? ticket.requester_name_snapshot ?? ticket.guest_name ?? 'ไม่ระบุ';
}

function requesterDepartment(ticket: TicketListItem): string {
  return ticket.department_name_snapshot ?? ticket.guest_department ?? '—';
}

function sourceLabel(source: string): string {
  if (source === 'line') return 'LINE';
  if (source === 'guest') return 'PUBLIC';
  return 'WEB';
}

interface TicketKpiCounts {
  all: number;
  newTickets: number;
  inProgress: number;
  critical: number;
  mine: number;
}

async function ticketFilterCount(query: string): Promise<number> {
  const result = await apiFetch<PaginatedResult<TicketListItem>>(`/api/v1/tickets?page=1&pageSize=10&${query}`);
  return result.pagination.totalItems;
}

const ticketSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกหัวข้อปัญหา'),
  categoryId: z.string().min(1, 'กรุณาเลือกหมวดหมู่'),
  priority: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต']).optional(),
  ),
  location: z.string().trim().optional(),
  requesterPhone: z.string().trim().optional(),
  incidentAt: z.string().min(1, 'กรุณาระบุวันที่และเวลาที่พบปัญหา'),
  erpModule: z.string().trim().max(120, 'ERP Module ต้องไม่เกิน 120 ตัวอักษร').optional(),
  assetId: z.string().optional(),
  isSecurity: z.boolean().optional(),
  description: z.string().trim().min(1, 'กรุณากรอกรายละเอียด'),
});

type TicketForm = z.infer<typeof ticketSchema>;

function currentLocalDateTime(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function CreateTicketForm({
  categories,
  assets,
  assetsLoading,
  initialAssetId,
  requester,
  onClose,
}: {
  categories: TicketCategory[];
  assets: AssetOption[];
  assetsLoading: boolean;
  /** เครื่องที่สแกนมาจากหน้างาน — เลือกไว้ให้ล่วงหน้าเพื่อไม่ให้ช่างต้องค้นหาเครื่องซ้ำ */
  initialAssetId?: string;
  requester: { fullName: string; position: string; department: string; phone: string };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [createdTicket, setCreatedTicket] = useState<{ id: string } | null>(null);
  const formId = useId();
  const titleRef = useRef<HTMLInputElement | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<TicketForm>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      title: '',
      description: '',
      location: '',
      assetId: initialAssetId ?? '',
      categoryId: '',
      isSecurity: false,
      priority: undefined,
      requesterPhone: requester.phone,
      incidentAt: currentLocalDateTime(),
      erpModule: '',
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: TicketForm) => {
      if (attachment && attachment.size > 10 * 1024 * 1024) {
        throw new ApiError('FILE_TOO_LARGE', 'ไฟล์ต้องมีขนาดไม่เกิน 10 MB');
      }
      const ticket = createdTicket ?? await apiFetch<{ id: string }>('/api/v1/tickets', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          assetId: values.assetId || undefined,
          priority: values.priority || undefined,
          erpModule: values.erpModule || undefined,
          incidentAt: new Date(values.incidentAt).toISOString(),
        }),
      }, { silent: true });

      setCreatedTicket(ticket);
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      if (attachment) {
        const data = new FormData();
        data.append('file', attachment);
        data.append('module', 'ticket');
        data.append('targetTable', 'tickets');
        data.append('targetId', ticket.id);
        await apiFetch('/api/v1/files', { method: 'POST', body: data }, { silent: true });
      }
      return ticket;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      showToast('success', 'ส่งใบแจ้งซ่อมเรียบร้อยแล้ว สามารถติดตามได้จากรายการแจ้งซ่อม');
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'แจ้งซ่อมไม่สำเร็จ'),
  });

  const fieldClass =
    'min-h-11 min-w-0 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-primary-900/40';
  const labelClass = 'mb-1.5 block text-[13px] font-semibold text-slate-600 dark:text-slate-300';

  const titleField = register('title');

  return (
    <FormModal
      title="เปิด Ticket แจ้งซ่อม"
      description="ระบุปัญหาและข้อมูลติดต่อ ช่องที่มี * จำเป็นต้องกรอก"
      size="lg"
      contentPadding="none"
      className="ticket-create-dialog"
      initialFocusRef={titleRef}
      isDirty={isDirty || Boolean(attachment) || Boolean(createdTicket)}
      closeDisabled={mutation.isPending}
      onClose={onClose}
      footer={<>
        <Button type="button" variant="outline" className="min-h-11 flex-1 sm:flex-none" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" form={formId} className="min-h-11 flex-1 sm:flex-none" isLoading={mutation.isPending}>{createdTicket ? 'ลองแนบไฟล์อีกครั้ง' : 'เปิด Ticket'}</Button>
      </>}
    >
      <form id={formId} onSubmit={handleSubmit((values) => { setServerError(null); mutation.mutate(values); })} noValidate>
        <div className="space-y-5 p-4 sm:p-6">
          <section aria-label="ข้อมูลผู้แจ้ง" className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-900/50">
            <p className="font-semibold text-slate-800 dark:text-slate-100">ผู้แจ้ง: <span>{requester.fullName || '—'}</span></p>
            <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400"><span>{requester.position || '—'}</span> · <span>{requester.department || '—'}</span></p>
          </section>
          <fieldset data-ui="form-grid" disabled={mutation.isPending || Boolean(createdTicket)} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-sm font-bold text-primary-800 dark:text-primary-200">1. ปัญหาที่ต้องการแจ้ง</legend>
            <div className="sm:col-span-2">
              <label htmlFor="tk-title" className={labelClass}>หัวข้อปัญหา <span className="text-red-500">*</span></label>
              <input id="tk-title" className={fieldClass} placeholder="เช่น เครื่องพิมพ์เชื่อมต่อไม่ได้" aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? 'tk-title-error' : undefined} {...titleField} ref={(element) => { titleField.ref(element); titleRef.current = element; }} />
              {errors.title && <p id="tk-title-error" className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
            </div>
            <div>
              <label htmlFor="tk-category" className={labelClass}>ประเภทงานที่ขอรับบริการ <span className="text-red-500">*</span></label>
              <select id="tk-category" className={fieldClass} aria-invalid={Boolean(errors.categoryId)} aria-describedby={errors.categoryId ? 'tk-category-error' : undefined} {...register('categoryId')}>
                <option value="">-- เลือกประเภทงาน --</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              {errors.categoryId && <p id="tk-category-error" className="mt-1 text-xs text-red-600">{errors.categoryId.message}</p>}
            </div>
            <div>
              <label htmlFor="tk-incident-at" className={labelClass}>วันที่และเวลาที่พบปัญหา <span className="text-red-500">*</span></label>
              <input id="tk-incident-at" type="datetime-local" className={fieldClass} aria-invalid={Boolean(errors.incidentAt)} aria-describedby={errors.incidentAt ? 'tk-incident-error' : undefined} {...register('incidentAt')} />
              {errors.incidentAt && <p id="tk-incident-error" className="mt-1 text-xs text-red-600">{errors.incidentAt.message}</p>}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="tk-description" className={labelClass}>รายละเอียดปัญหา <span className="text-red-500">*</span></label>
              <textarea id="tk-description" rows={3} className={fieldClass + ' min-h-28 resize-y py-3'} placeholder="พบอาการอะไร เกิดขึ้นเมื่อใด และลองแก้ไขอย่างไรแล้วบ้าง" aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? 'tk-description-error' : undefined} {...register('description')} />
              {errors.description && <p id="tk-description-error" className="mt-1 text-xs text-red-600">{errors.description.message}</p>}
            </div>
          </fieldset>
          <fieldset data-ui="form-grid" disabled={mutation.isPending || Boolean(createdTicket)} className="grid min-w-0 grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 dark:border-slate-700">
            <legend className="text-sm font-bold text-primary-800 dark:text-primary-200">2. สถานที่และข้อมูลติดต่อ</legend>
            <div>
              <label htmlFor="tk-location" className={labelClass}>สถานที่ตั้งเครื่อง</label>
              <input id="tk-location" className={fieldClass} placeholder="เช่น อาคาร A ชั้น 2 ห้องบัญชี" {...register('location')} />
            </div>
            <div>
              <label htmlFor="tk-phone" className={labelClass}>เบอร์โทรศัพท์</label>
              <input id="tk-phone" type="tel" inputMode="tel" className={fieldClass} {...register('requesterPhone')} />
            </div>
          </fieldset>
          <fieldset data-ui="form-grid" disabled={mutation.isPending || Boolean(createdTicket)} className="grid min-w-0 grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 dark:border-slate-700">
            <legend className="text-sm font-bold text-primary-800 dark:text-primary-200">3. ข้อมูลเพิ่มเติม (ถ้ามี)</legend>
            <div>
              <label htmlFor="tk-priority" className={labelClass}>ระดับความรุนแรง</label>
              <select id="tk-priority" className={fieldClass} {...register('priority', { setValueAs: (value: string) => value || undefined })}>
                <option value="">ให้ระบบกำหนดตามประเภทงาน</option>
                {TICKET_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="tk-asset" className={labelClass}>ผูกกับ Asset (ถ้ามี)</label>
              <select id="tk-asset" className={fieldClass} disabled={assetsLoading} {...register('assetId')}>
                <option value="">{assetsLoading ? 'กำลังโหลด...' : '-- ไม่ระบุอุปกรณ์ --'}</option>
                {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_code} — {asset.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="tk-erp-module" className={labelClass}>ERP Module (ถ้ามี)</label>
              <input id="tk-erp-module" className={fieldClass} placeholder="เช่น Finance, Inventory" {...register('erpModule')} />
              {errors.erpModule && <p className="mt-1 text-xs text-red-600">{errors.erpModule.message}</p>}
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 self-end text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" {...register('isSecurity')} />สงสัยภัยคุกคาม
            </label>
          </fieldset>
          <div>
            <label htmlFor="tk-attachment" className={labelClass}>แนบหลักฐาน/ภาพหน้าจอ</label>
            <input id="tk-attachment" type="file" disabled={mutation.isPending} accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} className="block min-h-11 w-full min-w-0 cursor-pointer rounded-xl border border-slate-300 bg-white text-sm text-slate-600 file:mr-3 file:min-h-11 file:border-0 file:border-r file:border-slate-300 file:bg-slate-50 file:px-3 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:file:border-slate-600 dark:file:bg-slate-800 dark:file:text-slate-200" />
            <p className="mt-1 text-xs text-slate-500">รองรับรูปภาพ เอกสาร และ PDF ขนาดไม่เกิน 10 MB</p>
          </div>
          {serverError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{createdTicket ? 'สร้างใบแจ้งซ่อมแล้ว แต่แนบไฟล์ไม่สำเร็จ กดลองแนบไฟล์อีกครั้งโดยไม่สร้างใบงานซ้ำ หรือยกเลิกเพื่อกลับไปรายการ' : serverError}</div>}
        </div>
      </form>
    </FormModal>
  );
}

export function TicketsPage() {
  const { me, hasPermission } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  /**
   * ลิงก์จากจอสแกนหน้างาน (/field/scan) เปิดฟอร์มแจ้งซ่อมพร้อมผูกเครื่องที่สแกนไว้แล้ว
   * ใช้ฟอร์มเดียวกับปุ่ม "เปิด Ticket" ปกติ ไม่ทำฟอร์มแยกให้ตรรกะ SLA/หมวดหมู่แตกกันสองทาง
   */
  const newForAssetId = searchParams.get('newForAsset') ?? '';
  const canCreateTicket = hasPermission('ticket.create');
  useEffect(() => {
    if (newForAssetId && canCreateTicket) setShowCreate(true);
  }, [newForAssetId, canCreateTicket]);
  const closeCreate = useCallback(() => {
    setShowCreate(false);
    if (!newForAssetId) return;
    // ล้าง param ทิ้ง ไม่งั้นการรีเฟรชหน้าจะเด้งฟอร์มขึ้นมาใหม่ทุกครั้ง
    const next = new URLSearchParams(searchParams);
    next.delete('newForAsset');
    setSearchParams(next, { replace: true });
  }, [newForAssetId, searchParams, setSearchParams]);
  const ticketNavigationState = { ticketReturnTo: `/tickets${searchParams.size ? `?${searchParams}` : ''}` };
  // รายการที่เลือกอยู่นอก URL เพราะเป็นสิ่งที่ทำแล้วจบ ไม่ใช่สถานะที่ควรแชร์ผ่านลิงก์
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkResult, setBulkResult] = useState<TicketBulkResult | null>(null);
  // สถานะของตารางอยู่ใน URL ทั้งหมด — refresh แล้วไม่หาย ส่งลิงก์ให้คนอื่นได้หน้าเดียวกัน
  const table = useTableParams<'status' | 'categoryId' | 'priority' | 'search' | 'mine' | 'queue'>({
    filters: ['status', 'categoryId', 'priority', 'search', 'mine', 'queue'],
  });
  const { page, pageSize, sort } = table;
  // ค่าเริ่มต้นคือใบงานล่าสุดขึ้นก่อน เหมือนตารางทุกโมดูล — เรียงตามกำหนด SLA ได้จากหัวคอลัมน์
  const effectiveSort = sort ?? { key: 'created_at', order: 'desc' as const };
  const { status, categoryId, priority, search: searchInput, queue } = table.filters;
  const mineOnly = table.filters.mine === 'true';
  const search = useDebouncedValue(searchInput.trim(), 350);
  const canManageTicket = hasPermission('ticket.update') || hasPermission('ticket.assign') || hasPermission('ticket.close') || hasPermission('ticket.triage');
  const canCloseTicket = hasPermission('ticket.close');

  /**
   * แก้ไขและยกเลิกจากหน้ารายการ ใช้ปลายทางเดียวกับหน้ารายละเอียด จึงผ่านกฎการเปลี่ยนสถานะ
   * และการตรวจสิทธิ์ชุดเดียวกันทั้งหมด — ฝั่งเซิร์ฟเวอร์เป็นผู้ตัดสินเสมอ ปุ่มที่ซ่อนเป็นเรื่องของสายตา
   */
  const updateTicket = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/api/v1/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });

  const categoriesQuery = useQuery({
    queryKey: ['admin', 'ticket-categories'],
    queryFn: () => apiFetch<TicketCategory[]>('/api/v1/ticket-categories'),
  });

  const assetOptionsQuery = useQuery({
    queryKey: ['assets', 'options'],
    queryFn: () => apiFetch<AssetOption[]>('/api/v1/assets/options'),
    enabled: showCreate && hasPermission('asset.view'),
  });

  const departmentsQuery = useQuery({
    queryKey: ['admin', 'departments'],
    queryFn: () => apiFetch<Department[]>('/api/v1/departments'),
    enabled: showCreate,
  });

  const positionsQuery = useQuery({
    queryKey: ['admin', 'positions'],
    queryFn: () => apiFetch<Position[]>('/api/v1/positions'),
    enabled: showCreate,
  });

  // query string ตัวเดียวกันทั้งรายการบนหน้าจอและไฟล์ที่ส่งออก (ฝั่ง api มองข้าม page/pageSize
  // ตอนส่งออก) — ถ้าประกอบแยกกัน ไฟล์จะมีข้อมูลไม่ตรงกับที่ผู้ใช้เห็นโดยไม่มีใครสังเกต
  const ticketListParams = (() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    params.set('sort', effectiveSort.key);
    params.set('order', effectiveSort.order);
    if (status) params.set('status', status);
    if (categoryId) params.set('categoryId', categoryId);
    if (priority) params.set('priority', priority);
    if (search) params.set('search', search);
    if (mineOnly) params.set('mine', 'true');
    if (queue) params.set('queue', queue);
    return params.toString();
  })();

  const ticketsQuery = useQuery({
    queryKey: ['tickets', ticketListParams],
    queryFn: () => apiFetch<PaginatedResult<TicketListItem>>(`/api/v1/tickets?${ticketListParams}`),
  });

  const kpiQuery = useQuery({
    queryKey: ['tickets', 'filter-counts', me?.profile.id],
    queryFn: async (): Promise<TicketKpiCounts> => {
      const [all, newTickets, inProgress, critical, mine] = await Promise.all([
        ticketFilterCount(''),
        ticketFilterCount(`status=${encodeURIComponent('ใหม่')}`),
        ticketFilterCount(`status=${encodeURIComponent('กำลังดำเนินการ')}`),
        ticketFilterCount(`priority=${encodeURIComponent('วิกฤต')}`),
        ticketFilterCount('mine=true'),
      ]);
      return { all, newTickets, inProgress, critical, mine };
    },
    staleTime: 60_000,
  });

  const queueQuery = useQuery({
    queryKey: ['tickets', 'queue-summary'],
    queryFn: () => apiFetch<TicketQueueSummary>('/api/v1/tickets/queue-summary'),
    staleTime: 30_000,
  });

  const staffQuery = useQuery({
    queryKey: ['tickets', 'assignable-staff'],
    queryFn: () => apiFetch<AssignableStaff[]>('/api/v1/tickets/assignable-staff'),
    enabled: showBulk,
  });

  function resetFilters() {
    table.reset();
  }

  const totalItems = ticketsQuery.data?.pagination.totalItems ?? 0;
  const overdueOnPage = (ticketsQuery.data?.items ?? []).filter((ticket) => ticket.sla_state === 'overdue' || (!ticket.sla_state && ticket.due_at && new Date(ticket.due_at).getTime() < Date.now() && !LOCKED_TICKET_STATUSES.includes(ticket.status) && !ticket.is_sla_paused)).length;
  const activeFilterCount = [status, categoryId, priority, searchInput, mineOnly ? 'true' : '', queue].filter(Boolean).length;

  function applyKpiFilter(values: { status?: TicketStatus; priority?: TicketPriority; mine?: boolean }) {
    table.setFilters({
      status: values.status ?? '',
      priority: values.priority ?? '',
      mine: values.mine ? 'true' : '',
      queue: '',
      categoryId: '',
      search: '',
    });
  }

  return (
    <div className="ticket-workspace flex min-w-0 flex-col gap-5">
      <PageHeader
        eyebrow="บริการและกระบวนการ IT / Ticket"
        title="แจ้งซ่อม / Help Desk"
        description="รับเรื่อง จัดคิว ติดตาม SLA และสื่อสารความคืบหน้าในหน้าจอเดียว"
        leading={<TicketIcon className="h-5 w-5" />}
        secondaryActions={<>
          <RequirePermission permission="report.view">
            <Button variant="outline" size="sm" onClick={() => navigate('/reports')}>
              <BarChart3 className="h-4 w-4" aria-hidden="true" /> วิเคราะห์ผล
            </Button>
          </RequirePermission>
          <RequirePermission permission="ticket_category.manage">
            <Button variant="outline" size="sm" onClick={() => navigate('/admin/master-data')}>
              <Tags className="h-4 w-4" aria-hidden="true" /> จัดการหมวดหมู่
            </Button>
          </RequirePermission>
        </>}
        primaryAction={
          <RequirePermission permission="ticket.create">
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" /> เปิด Ticket
            </Button>
          </RequirePermission>
        }
      />

      {showBulk && (
        <BulkTicketPanel
          ids={selectedIds}
          staff={staffQuery.data ?? []}
          onClose={() => setShowBulk(false)}
          onDone={(result) => {
            setShowBulk(false);
            setBulkResult(result);
            // เอาเฉพาะใบที่ทำไม่สำเร็จไว้ให้เลือกต่อ ผู้ใช้จะได้ลองแก้เฉพาะที่เหลือ
            setSelectedIds(result.failed.map((item) => item.id));
            void queryClient.invalidateQueries({ queryKey: ['tickets'] });
          }}
        />
      )}

      {bulkResult && <BulkResultSummary result={bulkResult} itemLabel="ใบงาน" onDismiss={() => setBulkResult(null)} />}

      {showCreate && !categoriesQuery.data && (
        <Modal title="เปิด Ticket แจ้งซ่อม" onClose={closeCreate} contentPadding="default">
          {categoriesQuery.isError
            ? <QueryError title="โหลดประเภทงานไม่สำเร็จ" error={categoriesQuery.error} onRetry={() => void categoriesQuery.refetch()} isRetrying={categoriesQuery.isFetching} />
            : <LoadingState label="กำลังเตรียมแบบฟอร์มแจ้งซ่อม..." />}
        </Modal>
      )}

      {showCreate && categoriesQuery.data && (
        <CreateTicketForm
          categories={categoriesQuery.data}
          assets={assetOptionsQuery.data ?? []}
          assetsLoading={assetOptionsQuery.isLoading}
          initialAssetId={newForAssetId || undefined}
          requester={{
            fullName: me?.profile.full_name ?? '',
            phone: me?.profile.phone ?? '',
            department: departmentsQuery.data?.find((item) => item.id === me?.profile.department_id)?.name_th ?? '',
            position: positionsQuery.data?.find((item) => item.id === me?.profile.position_id)?.name_th ?? '',
          }}
          onClose={closeCreate}
        />
      )}

      <KpiStrip
        label="สรุป Ticket ที่กดเพื่อกรองรายการได้"
        items={[
          {
            key: 'all',
            tone: 'gray',
            label: 'Ticket ทั้งหมด',
            value: kpiQuery.data?.all ?? '—',
            note: 'ตามสิทธิ์ที่เข้าถึงได้',
            icon: <FileText className="h-4 w-4" />,
            active: activeFilterCount === 0,
            onClick: resetFilters,
          },
          {
            key: 'new',
            tone: 'teal',
            label: 'Ticket ใหม่',
            value: kpiQuery.data?.newTickets ?? '—',
            note: 'ยังไม่ได้รับเรื่อง',
            icon: <TicketIcon className="h-5 w-5" />,
            active: status === 'ใหม่' && !priority && !mineOnly,
            onClick: () => applyKpiFilter(status === 'ใหม่' && !priority && !mineOnly ? {} : { status: 'ใหม่' }),
          },
          {
            key: 'in-progress',
            label: 'กำลังดำเนินการ',
            value: kpiQuery.data?.inProgress ?? '—',
            note: 'งานที่ทีมกำลังรับผิดชอบ',
            icon: <Clock3 className="h-5 w-5" />,
            active: status === 'กำลังดำเนินการ' && !priority && !mineOnly,
            onClick: () => applyKpiFilter(status === 'กำลังดำเนินการ' && !priority && !mineOnly ? {} : { status: 'กำลังดำเนินการ' }),
          },
          {
            key: 'critical',
            tone: 'danger',
            label: 'ความเร่งด่วนวิกฤต',
            value: kpiQuery.data?.critical ?? '—',
            note: 'ต้องจัดลำดับก่อนงานทั่วไป',
            icon: <ShieldAlert className="h-5 w-5" />,
            active: priority === 'วิกฤต' && !status && !mineOnly,
            onClick: () => applyKpiFilter(priority === 'วิกฤต' && !status && !mineOnly ? {} : { priority: 'วิกฤต' }),
          },
          {
            key: 'mine',
            tone: 'gray',
            label: 'Ticket ของฉัน',
            value: kpiQuery.data?.mine ?? '—',
            note: 'รายการที่ฉันเป็นผู้แจ้ง',
            icon: <Star className="h-5 w-5" />,
            active: mineOnly && !status && !priority,
            onClick: () => applyKpiFilter(mineOnly && !status && !priority ? {} : { mine: true }),
          },
          {
            key: 'overdue',
            tone: 'danger',
            label: 'เกิน SLA ในหน้านี้',
            value: overdueOnPage,
            note: 'จัดการก่อนคิวทั่วไป',
            icon: <AlertTriangle className="h-4 w-4" />,
          },
        ]}
      />

      <section aria-label="คิวงานเจ้าหน้าที่" className="rounded-card border border-hairline bg-white p-3 shadow-card dark:border-white/[.08] dark:bg-white/[.035]">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold text-ink-heading dark:text-[#e8eef9]">คิวงานเจ้าหน้าที่</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-white/45">พัก SLA จะไม่ถูกนับเป็นงานเกิน SLA</p>
          </div>
          {queue && <Button size="sm" variant="ghost" onClick={() => table.setFilter('queue', '')}>ล้างคิว</Button>}
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
          {([
            ['unassigned', 'ยังไม่มีผู้รับผิดชอบ', queueQuery.data?.unassigned ?? '—', 'secondary'],
            ['near_sla', 'ใกล้เกิน SLA', queueQuery.data?.nearSla ?? '—', 'warning'],
            ['overdue', 'เกิน SLA', queueQuery.data?.overdue ?? '—', 'danger'],
            ['waiting_follow_up', 'รอติดตาม', queueQuery.data?.waitingFollowUp ?? '—', 'warning'],
            ['awaiting_acceptance', 'รอตรวจรับ', queueQuery.data?.awaitingAcceptance ?? '—', 'warning'],
            ['paused', 'พัก SLA', queueQuery.data?.paused ?? '—', 'warning'],
          ] as const).map(([key, label, value, tone]) => (
            <button
              key={key}
              type="button"
              aria-pressed={queue === key}
              onClick={() => table.setFilters({ queue: queue === key ? '' : key, status: '', categoryId: '', priority: '', search: '', mine: '' })}
              className={cn('min-h-11 rounded-lg border px-3 py-2 text-left transition hover:border-primary-300 hover:bg-primary-50 dark:border-white/[.08] dark:hover:bg-white/[.05]', queue === key && 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20')}
            >
              <span className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"><span>{label}</span><Badge variant={tone}>{value}</Badge></span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-label="รายการ Ticket">
        <FilterBar
          searchValue={searchInput}
          onSearchChange={(value) => table.setFilter('search', value, { replace: true })}
          onSubmit={() => table.setPage(1)}
          searchPlaceholder="ค้นหาเลขที่ เรื่อง ผู้แจ้ง..."
          filters={<>
            <select
              aria-label="กรองตามสถานะ"
              value={status}
              onChange={(event) => table.setFilter('status', event.target.value)}
              className={`${filterControlClass} flex-1 xl:max-w-48`}
            >
              <option value="">สถานะ: ทั้งหมด</option>
              {TICKET_STATUSES.map((item) => <option key={item} value={item}>{ticketStatusLabel[item]}</option>)}
            </select>
            <select
              aria-label="กรองตามประเภทปัญหา"
              value={categoryId}
              onChange={(event) => table.setFilter('categoryId', event.target.value)}
              className={`${filterControlClass} flex-1 xl:max-w-48`}
            >
              <option value="">ประเภท: ทั้งหมด</option>
              {(categoriesQuery.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <select
              aria-label="กรองตามความเร่งด่วน"
              value={priority}
              onChange={(event) => table.setFilter('priority', event.target.value)}
              className={`${filterControlClass} flex-1 xl:max-w-48`}
            >
              <option value="">ความเร่งด่วน: ทั้งหมด</option>
              {TICKET_PRIORITIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </>}
          quickFilters={[
            { key: 'mine', label: 'ของฉันเท่านั้น', active: mineOnly, onClick: () => table.setFilter('mine', mineOnly ? '' : 'true') },
            { key: 'new', label: 'Ticket ใหม่', active: status === 'ใหม่', onClick: () => table.setFilter('status', status === 'ใหม่' ? '' : 'ใหม่') },
            { key: 'critical', label: 'วิกฤต', active: priority === 'วิกฤต', onClick: () => table.setFilter('priority', priority === 'วิกฤต' ? '' : 'วิกฤต') },
          ]}
          onClear={resetFilters}
          activeFilterCount={activeFilterCount}
          resultCount={totalItems}
          itemLabel="Ticket"
          actions={
            <ExportAllButton
              disabled={!ticketsQuery.data?.items.length}
              url={`/api/v1/tickets/export?${ticketListParams}`}
              label="ส่งออกผลที่กรอง"
            />
          }
        />

        {ticketsQuery.isLoading && <div className="rounded-card border border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-800"><LoadingState label="กำลังโหลดรายการ Ticket..." /></div>}

        {ticketsQuery.isError && (
          <div className="rounded-card border border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-800">
            <QueryError
              title="โหลดรายการ Ticket ไม่สำเร็จ"
              error={ticketsQuery.error}
              onRetry={() => void ticketsQuery.refetch()}
              isRetrying={ticketsQuery.isFetching}
            />
          </div>
        )}

        {ticketsQuery.data && ticketsQuery.data.items.length === 0 && (
          <div className="rounded-card border border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-800">
            <EmptyState
              icon={<TicketIcon className="h-10 w-10" aria-hidden="true" />}
              title="ไม่พบรายการแจ้งซ่อม"
              description={activeFilterCount > 0 ? 'ไม่มี Ticket ที่ตรงกับคำค้นหาและตัวกรองปัจจุบัน' : 'เมื่อมีการเปิด Ticket รายการใหม่จะแสดงที่นี่'}
              action={activeFilterCount > 0 ? <Button variant="outline" onClick={resetFilters}>ล้างตัวกรองทั้งหมด</Button> : undefined}
            />
          </div>
        )}

        <div className="min-w-0">
        {ticketsQuery.data && ticketsQuery.data.items.length > 0 && (
              <DataTable
                mode="server"
                tableId="tickets"
                sort={effectiveSort}
                onSortChange={table.setSort}
                rowNumberStart={(page - 1) * pageSize + 1}
                cardOnMobile
                itemLabel="ใบงาน"
                currentPageExport={false}
                selectable={canManageTicket}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                selectionActions={<Button type="button" size="sm" onClick={() => setShowBulk(true)}>ดำเนินการกับที่เลือก</Button>}
                containerClassName="rounded-card"
                className="ticket-list-table min-w-[920px] w-full text-left"
              >
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600 dark:bg-slate-900/70 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-3" data-sort-key="ticket_no">เลขที่</th>
                    <th className="px-3 py-3" data-sort-key="title">เรื่อง</th>
                    <th className="px-3 py-3" data-sort-key="due_at" data-sort-label="เรียงตามวันครบกำหนด SLA">สถานะ/SLA</th>
                    <th className="px-3 py-3">ผู้แจ้ง</th>
                    <th className="px-3 py-3">ผู้รับผิดชอบ / Outsource</th>
                    <th className="px-3 py-3 text-center">ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {ticketsQuery.data.items.map((ticket) => (
                    <tr
                      key={ticket.id}
                      data-row-id={ticket.id}
                      className={cn(
                        'align-top transition hover:bg-primary-50/60 dark:hover:bg-white/[.05]',
                        priorityRowClass[ticket.priority],
                      )}
                    >
                      <td className="px-3 py-3" data-label="เลขที่">
                        <p className="whitespace-nowrap font-mono text-xs text-slate-700 dark:text-slate-200">{ticket.ticket_no}</p>
                        <div className="mt-1"><Badge variant={priorityTone[ticket.priority]}>{ticket.priority}</Badge></div>
                      </td>
                      <td className="max-w-[260px] px-3 py-3" data-label="เรื่อง">
                        <Link to={`/tickets/${ticket.id}`} state={ticketNavigationState} className="font-semibold text-slate-800 hover:text-primary-700 hover:underline dark:text-slate-100 dark:hover:text-primary-300">
                          {ticket.title}
                        </Link>
                        {ticket.is_security && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-red-500" aria-label="Security" />}
                        <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{ticket.ticket_categories?.name ?? 'ไม่ระบุประเภท'} · {ticket.priority}</p>
                      </td>
                      <td className="px-3 py-3" data-label="สถานะ/SLA">
                        <StatusBadge display={{ label: ticketStatusLabel[ticket.status], tone: ticketStatusTone[ticket.status] }} />
                        <div className="mt-1"><SlaBadge display={ticketSlaBadge(ticket.due_at, ticket.status, new Date(), ticket.is_sla_paused || ticket.sla_state === 'paused')} fallback={ticket.due_at ? `ครบกำหนด ${formatThaiDate(ticket.due_at, 'd/MM/yyyy HH:mm')}` : 'ไม่กำหนด SLA'} /></div>
                      </td>
                      <td className="px-3 py-3" data-label="ผู้แจ้ง">
                        <p className="font-medium text-slate-700 dark:text-slate-200">{requesterName(ticket)}{ticket.requester_id === me?.profile.id ? ' (ของฉัน)' : ''}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{requesterDepartment(ticket)}</p>
                        <div className="mt-1"><Badge variant="secondary">{sourceLabel(ticket.source_channel)}</Badge></div>
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300" data-label="ผู้รับผิดชอบ / Outsource">
                        <p>{ticket.assignee?.full_name ?? ticket.assignee_name_snapshot ?? 'ยังไม่ได้มอบหมาย'}</p>
                        <p className="mt-1 text-xs text-slate-400">{ticket.outsource_name ? `Outsource: ${ticket.outsource_name}` : 'ทีมภายใน'}</p>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <RowActions
                          recordLabel={ticket.ticket_no}
                          iconOnly
                          actions={[
                            { kind: 'view', to: `/tickets/${ticket.id}`, state: ticketNavigationState, label: 'รายละเอียด' },
                            { kind: 'custom', icon: FileText, to: `/tickets/${ticket.id}/form`, state: ticketNavigationState, label: 'ดูแบบฟอร์ม' },
                            {
                              kind: 'edit',
                              label: 'ดำเนินการ',
                              hidden: !canManageTicket || ticket.status === 'เสร็จสิ้น' || LOCKED_TICKET_STATUSES.includes(ticket.status),
                              to: `/tickets/${ticket.id}?action=edit#ticket-work-panel`,
                              state: ticketNavigationState,
                            },
                            {
                              kind: 'cancel',
                              hidden: !canCloseTicket || LOCKED_TICKET_STATUSES.includes(ticket.status),
                              isPending: updateTicket.isPending,
                              reasonLabel: 'เหตุผลที่ยกเลิก',
                              reasonPlaceholder: 'เช่น ผู้แจ้งแก้ไขเองได้แล้ว / แจ้งซ้ำกับใบอื่น',
                              confirmDescription: 'Ticket จะถูกยกเลิกแต่ยังอยู่ในระบบพร้อมเหตุผล เพื่อให้ตรวจสอบย้อนหลังและออกรายงานได้ครบ',
                              onConfirm: (reason) => updateTicket.mutate({ id: ticket.id, body: { status: 'ยกเลิก', note: reason } }),
                            },
                            {
                              kind: 'delete',
                              permission: 'ticket.close',
                              deleteEndpoint: `/api/v1/record-deletions/tickets/${ticket.id}`,
                              confirmDescription: 'Ticket จะถูกนำออกจากรายการใช้งาน แต่ยังเก็บข้อมูลไว้ในฐานข้อมูลเพื่อการตรวจสอบย้อนหลัง',
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
        )}
        </div>

        {ticketsQuery.data && (
          <div className="border border-t-0 border-slate-200 bg-white px-3 pb-3 dark:border-slate-700 dark:bg-slate-800">
            <TablePagination page={ticketsQuery.data.pagination.page} pageSize={pageSize} totalItems={totalItems} totalPages={ticketsQuery.data.pagination.totalPages} onPageChange={table.setPage} onPageSizeChange={table.setPageSize} />
          </div>
        )}
      </section>
    </div>
  );
}
