import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Plus, Ticket as TicketIcon, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useAuth } from '../../stores/authContext';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { TicketCategory } from '../../types/admin';
import type { PaginatedResult } from '../../types/admin';
import type { TicketListItem, TicketPriority, TicketStatus } from '../../types/tickets';
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

const ticketSchema = z.object({
  title: z.string().trim().min(1, 'กรุณากรอกหัวข้อปัญหา'),
  categoryId: z.string().min(1, 'กรุณาเลือกหมวดหมู่'),
  priority: z.enum(['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต']).optional(),
  location: z.string().trim().optional(),
  requesterPhone: z.string().trim().optional(),
  description: z.string().trim().min(1, 'กรุณากรอกรายละเอียด'),
});

type TicketForm = z.infer<typeof ticketSchema>;

function CreateTicketForm({ categories, onClose }: { categories: TicketCategory[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TicketForm>({ resolver: zodResolver(ticketSchema) });

  const mutation = useMutation({
    mutationFn: (values: TicketForm) => apiFetch('/api/v1/tickets', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'แจ้งปัญหาไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-900/40"
      noValidate
    >
      <div className="flex items-center justify-between sm:col-span-2">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">แจ้งปัญหาใหม่</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="tk-title" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          หัวข้อปัญหา
        </label>
        <input
          id="tk-title"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('title')}
        />
        {errors.title && <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>}
      </div>

      <div>
        <label htmlFor="tk-category" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          หมวดหมู่
        </label>
        <select
          id="tk-category"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('categoryId')}
        >
          <option value="">— เลือกหมวดหมู่ —</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
        {errors.categoryId && <p className="mt-1 text-xs text-red-600">{errors.categoryId.message}</p>}
      </div>

      <div>
        <label htmlFor="tk-priority" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ความเร่งด่วน (ไม่ระบุ = ใช้ค่าเริ่มต้นของหมวดหมู่)
        </label>
        <select
          id="tk-priority"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('priority')}
        >
          <option value="">— ค่าเริ่มต้น —</option>
          <option value="ต่ำ">ต่ำ</option>
          <option value="ปานกลาง">ปานกลาง</option>
          <option value="สูง">สูง</option>
          <option value="วิกฤต">วิกฤต</option>
        </select>
      </div>

      <div>
        <label htmlFor="tk-location" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          สถานที่ (ถ้ามี)
        </label>
        <input
          id="tk-location"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('location')}
        />
      </div>

      <div>
        <label htmlFor="tk-phone" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          เบอร์ติดต่อ (ถ้ามี)
        </label>
        <input
          id="tk-phone"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('requesterPhone')}
        />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="tk-description" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          รายละเอียด
        </label>
        <textarea
          id="tk-description"
          rows={3}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('description')}
        />
        {errors.description && <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>}
      </div>

      {serverError && <p className="text-xs text-red-600 sm:col-span-2">{serverError}</p>}

      <div className="sm:col-span-2">
        <Button type="submit" size="sm" isLoading={isSubmitting}>
          ส่งเรื่อง
        </Button>
      </div>
    </form>
  );
}

export function TicketsPage() {
  const { me } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [status, setStatus] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [page, setPage] = useState(1);

  const categoriesQuery = useQuery({
    queryKey: ['admin', 'ticket-categories'],
    queryFn: () => apiFetch<TicketCategory[]>('/api/v1/ticket-categories'),
  });

  const ticketsQuery = useQuery({
    queryKey: ['tickets', page, status, mineOnly],
    queryFn: () =>
      apiFetch<PaginatedResult<TicketListItem>>(
        `/api/v1/tickets?page=${page}&pageSize=20${status ? `&status=${encodeURIComponent(status)}` : ''}${mineOnly ? '&mine=true' : ''}`,
      ),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Ticket</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">แจ้งปัญหาและติดตามสถานะการดำเนินงาน</p>
        </div>
        <RequirePermission permission="ticket.create">
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            แจ้งปัญหาใหม่
          </Button>
        </RequirePermission>
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <span>รายการ Ticket</span>
          <div className="flex flex-wrap items-center gap-2 text-xs font-normal">
            <button
              type="button"
              onClick={() => {
                setMineOnly((v) => !v);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1 ${mineOnly ? 'bg-primary-700 text-white' : 'border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}
            >
              ของฉันเท่านั้น
            </button>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="rounded-full border border-slate-300 px-3 py-1 dark:border-slate-600 dark:bg-slate-900"
            >
              <option value="">ทุกสถานะ</option>
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {showCreate && categoriesQuery.data && (
            <CreateTicketForm categories={categoriesQuery.data} onClose={() => setShowCreate(false)} />
          )}

          {ticketsQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}

          {ticketsQuery.data && ticketsQuery.data.items.length === 0 && (
            <EmptyState icon={<TicketIcon className="h-10 w-10" aria-hidden="true" />} title="ไม่พบ Ticket" />
          )}

          {ticketsQuery.data && ticketsQuery.data.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">หัวข้อ</th>
                    <th className="px-2 py-2">หมวดหมู่</th>
                    <th className="px-2 py-2">ความเร่งด่วน</th>
                    <th className="px-2 py-2">สถานะ</th>
                    <th className="px-2 py-2">ครบกำหนด</th>
                    <th className="px-2 py-2">แจ้งเมื่อ</th>
                  </tr>
                </thead>
                <tbody>
                  {ticketsQuery.data.items.map((t) => (
                    <tr key={t.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-2 py-2">
                        <Link to={`/tickets/${t.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
                          {t.title}
                        </Link>
                        {t.is_security && (
                          <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-red-500" aria-label="Security" />
                        )}
                        {t.requester_id === me?.profile.id && (
                          <span className="ml-1 text-xs text-slate-400">(ของฉัน)</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{t.ticket_categories?.name ?? '—'}</td>
                      <td className="px-2 py-2">
                        <Badge variant={priorityTone[t.priority]}>{t.priority}</Badge>
                      </td>
                      <td className="px-2 py-2">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">
                        {t.due_at ? formatThaiDate(t.due_at, 'd MMM yyyy HH:mm') : '—'}
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">
                        {formatThaiDate(t.created_at, 'd MMM yyyy HH:mm')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {ticketsQuery.data && ticketsQuery.data.pagination.totalPages > 1 && (
            <div className="mt-3 flex items-center justify-center gap-3 text-sm">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40 dark:border-slate-600"
              >
                ก่อนหน้า
              </button>
              <span className="text-slate-500 dark:text-slate-400">
                หน้า {ticketsQuery.data.pagination.page} / {ticketsQuery.data.pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={page >= ticketsQuery.data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40 dark:border-slate-600"
              >
                ถัดไป
              </button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
