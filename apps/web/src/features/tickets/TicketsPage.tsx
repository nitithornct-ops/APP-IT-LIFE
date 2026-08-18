import { DataTable, TablePagination } from '../../components/table/DataTable';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  Clock3,
  Download,
  FilterX,
  Loader2,
  Plus,
  Search,
  ShieldAlert,
  Star,
  Tags,
  Ticket as TicketIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { RowActions } from '../../components/table/RowActions';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { QueryError } from '../../components/ui/QueryError';
import { FormModal } from '../../components/ui/Modal';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useAuth } from '../../stores/authContext';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { TicketCategory } from '../../types/admin';
import type { PaginatedResult } from '../../types/admin';
import type { AssetOption } from '../../types/assets';
import type { TicketListItem, TicketPriority, TicketStatus, TicketSummary } from '../../types/tickets';
import { formatThaiDate } from '../../utils/date';

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

const priorityTone: Record<TicketPriority, 'secondary' | 'info' | 'warning' | 'danger'> = {
  ต่ำ: 'secondary',
  ปานกลาง: 'info',
  สูง: 'warning',
  วิกฤต: 'danger',
};

const statusTone: Record<TicketStatus, 'secondary' | 'info' | 'warning' | 'success' | 'danger' | 'primary'> = {
  ใหม่: 'info',
  รับเรื่องแล้ว: 'primary',
  กำลังดำเนินการ: 'primary',
  รออะไหล่: 'warning',
  รอผู้ใช้งาน: 'warning',
  'ส่งต่อ Outsource': 'warning',
  เสร็จสิ้น: 'success',
  ปิดงาน: 'success',
  ยกเลิก: 'secondary',
  'ยกระดับเป็น Incident': 'danger',
};

function StatusBadge({ status }: { status: TicketStatus }) {
  return <Badge variant={statusTone[status]}>{status}</Badge>;
}

function TicketMetricCard({
  icon,
  value,
  label,
  note,
  tone,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
  note: string;
  tone: 'blue' | 'teal' | 'slate';
}) {
  const toneClass = {
    blue: 'bg-blue-600 border-blue-500',
    teal: 'bg-teal-700 border-teal-500',
    slate: 'bg-slate-500 border-slate-400',
  }[tone];
  return (
    <Card className={`relative flex min-h-[102px] items-center gap-3 overflow-hidden border-b-[3px] p-4 ${toneClass.split(' ')[1]}`}>
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ${toneClass.split(' ')[0]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-extrabold leading-none text-slate-900 dark:text-white">{value}</p>
        <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">{note}</p>
      </div>
    </Card>
  );
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
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

const ticketSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกหัวข้อปัญหา'),
  categoryId: z.string().min(1, 'กรุณาเลือกหมวดหมู่'),
  priority: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต']).optional(),
  ),
  location: z.string().trim().optional(),
  requesterPhone: z.string().trim().optional(),
  assetId: z.string().optional(),
  isSecurity: z.boolean().optional(),
  description: z.string().trim().min(1, 'กรุณากรอกรายละเอียด'),
});

type TicketForm = z.infer<typeof ticketSchema>;

function CreateTicketForm({
  categories,
  assets,
  assetsLoading,
  onClose,
}: {
  categories: TicketCategory[];
  assets: AssetOption[];
  assetsLoading: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TicketForm>({
    resolver: zodResolver(ticketSchema),
    defaultValues: { assetId: '', categoryId: '', isSecurity: false, priority: undefined },
  });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const mutation = useMutation({
    mutationFn: async (values: TicketForm) => {
      if (attachment && attachment.size > 10 * 1024 * 1024) {
        throw new ApiError('FILE_TOO_LARGE', 'ไฟล์ต้องมีขนาดไม่เกิน 10 MB');
      }
      const ticket = await apiFetch<{ id: string }>('/api/v1/tickets', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          assetId: values.assetId || undefined,
          priority: values.priority || undefined,
        }),
      });

      if (attachment) {
        const data = new FormData();
        data.append('file', attachment);
        data.append('module', 'ticket');
        data.append('targetTable', 'tickets');
        data.append('targetId', ticket.id);
        await apiFetch('/api/v1/files', { method: 'POST', body: data });
      }
      return ticket;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'แจ้งซ่อมไม่สำเร็จ'),
  });

  const fieldClass =
    'min-h-[45px] w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-blue-900/40';
  const labelClass = 'mb-1.5 block text-[13px] font-semibold text-slate-600 dark:text-slate-300';

  return (
    <FormModal title="เปิด Ticket แจ้งซ่อม" description="ระบุปัญหา สถานที่ และหลักฐานเพื่อส่งเข้าคิวบริการ" size="lg" closeDisabled={mutation.isPending} onClose={onClose}>
      <form
        onSubmit={handleSubmit((values) => {
          setServerError(null);
          mutation.mutate(values);
        })}
        noValidate
      >
        <div className="grid grid-cols-1 gap-x-3 gap-y-5 px-5 py-6 md:grid-cols-3">
          <div className="md:col-span-2">
            <label htmlFor="tk-title" className={labelClass}>
              หัวข้อปัญหา <span className="text-red-500">*</span>
            </label>
            <input id="tk-title" autoFocus className={fieldClass} {...register('title')} />
            {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
          </div>

          <div>
            <label htmlFor="tk-category" className={labelClass}>
              ประเภทปัญหา <span className="text-red-500">*</span>
            </label>
            <select id="tk-category" className={fieldClass} {...register('categoryId')}>
              <option value="">-- เลือก --</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            {errors.categoryId && <p className="mt-1 text-xs text-red-600">{errors.categoryId.message}</p>}
          </div>

          <div>
            <label htmlFor="tk-priority" className={labelClass}>ความเร่งด่วน</label>
            <select id="tk-priority" className={fieldClass} {...register('priority')}>
              <option value="">-- เลือก --</option>
              <option value="ต่ำ">ต่ำ</option>
              <option value="ปานกลาง">ปานกลาง</option>
              <option value="สูง">สูง</option>
              <option value="วิกฤต">วิกฤต</option>
            </select>
          </div>

          <div>
            <label htmlFor="tk-phone" className={labelClass}>เบอร์โทรติดต่อ</label>
            <input id="tk-phone" inputMode="tel" className={fieldClass} {...register('requesterPhone')} />
          </div>

          <div>
            <label htmlFor="tk-location" className={labelClass}>สถานที่ตั้งเครื่อง</label>
            <input id="tk-location" className={fieldClass} {...register('location')} />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="tk-asset" className={labelClass}>ผูกกับ Asset (ถ้ามี)</label>
            <select id="tk-asset" className={fieldClass} disabled={assetsLoading} {...register('assetId')}>
              <option value="">{assetsLoading ? 'กำลังโหลด...' : '-- เลือก --'}</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.asset_code} — {asset.name}</option>
              ))}
            </select>
          </div>

          <label className="flex min-h-[45px] cursor-pointer items-center gap-2 self-end pb-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              {...register('isSecurity')}
            />
            สงสัยภัยคุกคาม
          </label>

          <div className="md:col-span-3">
            <label htmlFor="tk-description" className={labelClass}>
              รายละเอียดปัญหา <span className="text-red-500">*</span>
            </label>
            <textarea
              id="tk-description"
              rows={4}
              className={`${fieldClass} min-h-[108px] resize-y py-3`}
              {...register('description')}
            />
            {errors.description && <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>}
          </div>

          <div className="md:col-span-3">
            <label htmlFor="tk-attachment" className={labelClass}>แนบหลักฐาน/ภาพหน้าจอ</label>
            <input
              id="tk-attachment"
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
              onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
              className="block min-h-[45px] w-full cursor-pointer rounded-xl border border-slate-300 bg-white text-sm text-slate-600 file:mr-3 file:min-h-[43px] file:cursor-pointer file:border-0 file:border-r file:border-slate-300 file:bg-white file:px-3 file:text-sm file:text-slate-700 hover:file:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:file:border-slate-600 dark:file:bg-slate-800 dark:file:text-slate-200"
            />
            <p className="mt-1 text-xs text-slate-400">รองรับรูปภาพ เอกสาร และ PDF ขนาดไม่เกิน 10 MB</p>
          </div>

          {serverError && <p className="text-sm text-red-600 md:col-span-3">{serverError}</p>}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/50">
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button>
          <Button type="submit" isLoading={mutation.isPending}>เปิด Ticket</Button>
        </footer>
      </form>
    </FormModal>
  );
}

export function TicketsPage() {
  const { me, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 350);
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const categoriesQuery = useQuery({
    queryKey: ['admin', 'ticket-categories'],
    queryFn: () => apiFetch<TicketCategory[]>('/api/v1/ticket-categories'),
  });

  const assetOptionsQuery = useQuery({
    queryKey: ['assets', 'options'],
    queryFn: () => apiFetch<AssetOption[]>('/api/v1/assets/options'),
    enabled: showCreate && hasPermission('asset.view'),
  });

  const ticketsQuery = useQuery({
    queryKey: ['tickets', page, pageSize, status, categoryId, priority, search, mineOnly],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (status) params.set('status', status);
      if (categoryId) params.set('categoryId', categoryId);
      if (priority) params.set('priority', priority);
      if (search) params.set('search', search);
      if (mineOnly) params.set('mine', 'true');
      return apiFetch<PaginatedResult<TicketListItem>>(`/api/v1/tickets?${params.toString()}`);
    },
  });

  const summaryQuery = useQuery({
    queryKey: ['tickets', 'summary'],
    queryFn: () => apiFetch<TicketSummary>('/api/v1/tickets/summary'),
  });

  function resetFilters() {
    setSearchInput('');
    setStatus('');
    setCategoryId('');
    setPriority('');
    setMineOnly(false);
    setPage(1);
  }

  function exportCurrentPage() {
    const rows = ticketsQuery.data?.items ?? [];
    const header = ['ลำดับ', 'เลขที่ Ticket', 'เรื่อง', 'ผู้แจ้ง', 'หน่วยงาน', 'ประเภท', 'ความเร่งด่วน', 'สถานะ', 'ครบกำหนด SLA', 'ผู้รับผิดชอบ', 'Outsource'];
    const body = rows.map((ticket, index) => [
      (page - 1) * pageSize + index + 1,
      ticket.ticket_no,
      ticket.title,
      requesterName(ticket),
      requesterDepartment(ticket),
      ticket.ticket_categories?.name ?? '',
      ticket.priority,
      ticket.status,
      ticket.due_at ? formatThaiDate(ticket.due_at, 'd/MM/yyyy HH:mm') : '',
      ticket.assignee?.full_name ?? ticket.assignee_name_snapshot ?? '',
      ticket.outsource_name ?? '',
    ]);
    const csv = `\uFEFF${[header, ...body].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tickets-page-${page}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const summary = summaryQuery.data;
  const totalItems = ticketsQuery.data?.pagination.totalItems ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-900 dark:text-white">
            <TicketIcon className="h-6 w-6 text-blue-600" aria-hidden="true" />
            แจ้งซ่อม / Help Desk
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">รับเรื่อง จัดคิว ติดตาม SLA และสื่อสารความคืบหน้าในหน้าจอเดียว</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          <RequirePermission permission="ticket.create">
            <Button size="sm" onClick={() => setShowCreate((value) => !value)}>
              <Plus className="h-4 w-4" aria-hidden="true" /> เปิด Ticket
            </Button>
          </RequirePermission>
        </div>
      </div>

      {showCreate && categoriesQuery.data && (
        <CreateTicketForm
          categories={categoriesQuery.data}
          assets={assetOptionsQuery.data ?? []}
          assetsLoading={assetOptionsQuery.isLoading}
          onClose={() => setShowCreate(false)}
        />
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="สรุป Ticket">
        <TicketMetricCard icon={<TicketIcon className="h-5 w-5" />} value={summary?.open ?? '—'} label="Ticket เปิดอยู่" note="ยังไม่เสร็จสิ้นหรือปิดงาน" tone="blue" />
        <TicketMetricCard icon={<Clock3 className="h-5 w-5" />} value={summary?.overdue ?? '—'} label="เกิน SLA" note="จาก Ticket เปิดอยู่" tone="teal" />
        <TicketMetricCard icon={<ShieldAlert className="h-5 w-5" />} value={summary?.security ?? '—'} label="เข้าข่ายภัยคุกคาม" note="Ticket ที่ทำเครื่องหมาย Security" tone="slate" />
        <TicketMetricCard icon={<Star className="h-5 w-5" />} value={summary?.averageRating ?? '—'} label="คะแนนเฉลี่ย" note={`${summary?.ratingCount ?? 0} รายการที่ประเมิน`} tone="teal" />
      </section>

      <Card>
        <CardBody className="p-4 sm:p-5">
          <form
            className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 xl:flex-row xl:items-center dark:border-slate-700 dark:bg-slate-900/40"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
            }}
          >
            <label className="relative min-w-0 flex-1 xl:max-w-sm">
              <span className="sr-only">ค้นหาในรายการ</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                value={searchInput}
                onChange={(event) => { setSearchInput(event.target.value); setPage(1); }}
                maxLength={120}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                placeholder="ค้นหาเลขที่ เรื่อง ผู้แจ้ง..."
              />
            </label>
            <select
              aria-label="กรองตามสถานะ"
              value={status}
              onChange={(event) => { setStatus(event.target.value); setPage(1); }}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            >
              <option value="">สถานะ: ทั้งหมด</option>
              {TICKET_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select
              aria-label="กรองตามประเภทปัญหา"
              value={categoryId}
              onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            >
              <option value="">ประเภท: ทั้งหมด</option>
              {(categoriesQuery.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <select
              aria-label="กรองตามความเร่งด่วน"
              value={priority}
              onChange={(event) => { setPriority(event.target.value); setPage(1); }}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            >
              <option value="">ความเร่งด่วน: ทั้งหมด</option>
              {TICKET_PRIORITIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <button type="submit" className="sr-only">ค้นหา</button>
            <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
              <button
                type="button"
                onClick={() => {
                  setMineOnly((value) => !value);
                  setPage(1);
                }}
                className={`h-9 rounded-lg px-3 text-xs font-semibold ${mineOnly ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
              >
                ของฉันเท่านั้น
              </button>
              <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
                <FilterX className="h-4 w-4" aria-hidden="true" /> ล้างตัวกรอง
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={exportCurrentPage} disabled={!ticketsQuery.data?.items.length} className="text-emerald-700">
                <Download className="h-4 w-4" aria-hidden="true" /> ส่งออก
              </Button>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">{totalItems} รายการ</span>
            </div>
          </form>

          {ticketsQuery.isLoading && (
            <div className="flex justify-center py-12" role="status">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}

          {ticketsQuery.isError && (
            <QueryError
              title="โหลดรายการ Ticket ไม่สำเร็จ"
              error={ticketsQuery.error}
              onRetry={() => void ticketsQuery.refetch()}
              isRetrying={ticketsQuery.isFetching}
            />
          )}

          {ticketsQuery.data && ticketsQuery.data.items.length === 0 && (
            <EmptyState icon={<TicketIcon className="h-10 w-10" aria-hidden="true" />} title="ไม่พบรายการแจ้งซ่อม" />
          )}

          {ticketsQuery.data && ticketsQuery.data.items.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <DataTable pagination={false} className="min-w-[1120px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600 dark:bg-slate-900/70 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-3">ลำดับ</th>
                    <th className="px-3 py-3">เลขที่</th>
                    <th className="px-3 py-3">เรื่อง</th>
                    <th className="px-3 py-3">ผู้แจ้ง</th>
                    <th className="px-3 py-3">สถานะ/SLA</th>
                    <th className="px-3 py-3">ผู้รับผิดชอบ</th>
                    <th className="px-3 py-3">Outsource</th>
                    <th className="px-3 py-3 text-center">ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {ticketsQuery.data.items.map((ticket, index) => (
                    <tr key={ticket.id} className="align-top transition hover:bg-blue-50/40 dark:hover:bg-slate-700/30">
                      <td className="px-3 py-3 text-slate-500">{(page - 1) * pageSize + index + 1}</td>
                      <td className="px-3 py-3">
                        <p className="whitespace-nowrap font-mono text-xs text-slate-700 dark:text-slate-200">{ticket.ticket_no}</p>
                        <div className="mt-1"><Badge variant={priorityTone[ticket.priority]}>{ticket.priority}</Badge></div>
                      </td>
                      <td className="max-w-[260px] px-3 py-3">
                        <Link to={`/tickets/${ticket.id}`} className="font-semibold text-slate-800 hover:text-blue-700 hover:underline dark:text-slate-100 dark:hover:text-blue-300">
                          {ticket.title}
                        </Link>
                        {ticket.is_security && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-red-500" aria-label="Security" />}
                        <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{ticket.ticket_categories?.name ?? 'ไม่ระบุประเภท'} · {ticket.priority}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-slate-700 dark:text-slate-200">{requesterName(ticket)}{ticket.requester_id === me?.profile.id ? ' (ของฉัน)' : ''}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{requesterDepartment(ticket)}</p>
                        <span className="mt-1 inline-flex rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{sourceLabel(ticket.source_channel)}</span>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={ticket.status} />
                        <p className="mt-1 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">{ticket.due_at ? formatThaiDate(ticket.due_at, 'd/MM/yyyy HH:mm') : 'ไม่กำหนด SLA'}</p>
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{ticket.assignee?.full_name ?? ticket.assignee_name_snapshot ?? '—'}</td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{ticket.outsource_name ?? '—'}</td>
                      <td className="px-3 py-3 text-right">
                        <RowActions recordLabel={ticket.ticket_no} actions={[{ kind: 'view', to: `/tickets/${ticket.id}`, label: 'รายละเอียด' }]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          )}

          {ticketsQuery.data && <TablePagination page={ticketsQuery.data.pagination.page} pageSize={pageSize} totalItems={totalItems} totalPages={ticketsQuery.data.pagination.totalPages} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />}
        </CardBody>
      </Card>
    </div>
  );
}
