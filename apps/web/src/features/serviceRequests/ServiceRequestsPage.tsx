import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { PaginatedResult } from '../../types/admin';
import type { ServiceCatalogItem } from '../../types/serviceCatalog';
import type { ServiceRequestListItem, ServiceRequestStatus } from '../../types/serviceRequests';
import { formatThaiDate } from '../../utils/date';

const REQUEST_STATUSES: ServiceRequestStatus[] = [
  'รออนุมัติ',
  'รอมอบหมาย',
  'กำลังดำเนินการ',
  'รอผู้ใช้งาน',
  'รอผู้ให้บริการ',
  'รอยืนยันผล',
  'ปิดงาน',
  'ปฏิเสธ',
  'ยกเลิก',
];

const statusTone: Record<ServiceRequestStatus, 'secondary' | 'info' | 'warning' | 'success' | 'danger' | 'primary'> = {
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

function StatusBadge({ status }: { status: ServiceRequestStatus }) {
  return <Badge variant={statusTone[status]}>{status}</Badge>;
}

const submitSchema = z.object({
  catalogId: z.string().min(1, 'กรุณาเลือกบริการ'),
  summary: z.string().trim().optional(),
  requestedFor: z.string().trim().optional(),
  businessJustification: z.string().trim().optional(),
  // <select> ที่ยังไม่ได้เลือกจะส่งค่า "" มาเสมอ ซึ่ง z.enum(...).optional() ไม่ยอมรับ (รับแค่
  // undefined) — ต้องรับ "" แล้วแปลงเป็น undefined เอง ไม่งั้น validation จะ fail แบบไม่มี error
  // แสดงให้เห็น (ไม่เรียก mutationFn เลย) เหมือนบั๊กเดิมที่เจอใน Module 3 (EmployeesPage)
  priority: z
    .union([z.enum(['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต']), z.literal('')])
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
});

type SubmitForm = z.infer<typeof submitSchema>;

function SubmitRequestForm({ catalog, onClose }: { catalog: ServiceCatalogItem[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SubmitForm>({ resolver: zodResolver(submitSchema) });

  const mutation = useMutation({
    mutationFn: (values: SubmitForm) => apiFetch('/api/v1/service-requests', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-requests'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'ยื่นคำขอไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-900/40"
      noValidate
    >
      <div className="flex items-center justify-between sm:col-span-2">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">ยื่นคำขอบริการใหม่</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="sr-catalog" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          บริการที่ต้องการขอ
        </label>
        <select
          id="sr-catalog"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('catalogId')}
        >
          <option value="">— เลือกบริการ —</option>
          {catalog.map((c) => (
            <option key={c.id} value={c.id}>
              {c.service_name} {c.category ? `(${c.category})` : ''}
            </option>
          ))}
        </select>
        {errors.catalogId && <p className="mt-1 text-xs text-red-600">{errors.catalogId.message}</p>}
      </div>

      <div>
        <label htmlFor="sr-requested-for" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ขอให้ใคร (ถ้าไม่ใช่ตนเอง)
        </label>
        <input
          id="sr-requested-for"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('requestedFor')}
        />
      </div>

      <div>
        <label htmlFor="sr-priority" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ความเร่งด่วน
        </label>
        <select
          id="sr-priority"
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

      <div className="sm:col-span-2">
        <label htmlFor="sr-summary" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          หัวข้อคำขอ
        </label>
        <input
          id="sr-summary"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('summary')}
        />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="sr-justification" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          เหตุผล/รายละเอียดเพิ่มเติม
        </label>
        <textarea
          id="sr-justification"
          rows={3}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('businessJustification')}
        />
      </div>

      {serverError && <p className="text-xs text-red-600 sm:col-span-2">{serverError}</p>}

      <div className="sm:col-span-2">
        <Button type="submit" size="sm" isLoading={isSubmitting}>
          ส่งคำขอ
        </Button>
      </div>
    </form>
  );
}

export function ServiceRequestsPage() {
  const { me, hasPermission } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [status, setStatus] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [pendingApprovalOnly, setPendingApprovalOnly] = useState(false);
  const [page, setPage] = useState(1);

  const catalogQuery = useQuery({
    queryKey: ['service-catalog', 'active'],
    queryFn: () => apiFetch<PaginatedResult<ServiceCatalogItem>>('/api/v1/service-catalog?pageSize=100'),
  });

  const requestsQuery = useQuery({
    queryKey: ['service-requests', page, status, mineOnly, pendingApprovalOnly],
    queryFn: () =>
      apiFetch<PaginatedResult<ServiceRequestListItem>>(
        `/api/v1/service-requests?page=${page}&pageSize=20${status ? `&status=${encodeURIComponent(status)}` : ''}${mineOnly ? '&mine=true' : ''}${pendingApprovalOnly ? '&pendingMyApproval=true' : ''}`,
      ),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">คำขอบริการ</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">เลือกบริการจาก Catalog แล้วยื่นคำขอ พร้อมติดตามสถานะ</p>
        </div>
        {hasPermission('service_request.create') && (
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            ยื่นคำขอใหม่
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <span>รายการคำขอ</span>
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
            <button
              type="button"
              onClick={() => {
                setPendingApprovalOnly((v) => !v);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1 ${pendingApprovalOnly ? 'bg-primary-700 text-white' : 'border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}
            >
              รอฉันอนุมัติ
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
              {REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {showCreate && catalogQuery.data && <SubmitRequestForm catalog={catalogQuery.data.items} onClose={() => setShowCreate(false)} />}

          {requestsQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}

          {requestsQuery.data && requestsQuery.data.items.length === 0 && (
            <EmptyState icon={<ClipboardList className="h-10 w-10" aria-hidden="true" />} title="ไม่พบคำขอบริการ" />
          )}

          {requestsQuery.data && requestsQuery.data.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">หัวข้อ</th>
                    <th className="px-2 py-2">ความเร่งด่วน</th>
                    <th className="px-2 py-2">สถานะ</th>
                    <th className="px-2 py-2">ครบกำหนด</th>
                    <th className="px-2 py-2">ยื่นเมื่อ</th>
                  </tr>
                </thead>
                <tbody>
                  {requestsQuery.data.items.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-2 py-2">
                        <Link to={`/service-requests/${r.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
                          {r.service_name}
                        </Link>
                        {r.requester_id === me?.profile.id && <span className="ml-1 text-xs text-slate-400">(ของฉัน)</span>}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant="secondary">{r.priority}</Badge>
                      </td>
                      <td className="px-2 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">
                        {r.due_at ? formatThaiDate(r.due_at, 'd MMM yyyy HH:mm') : '—'}
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{formatThaiDate(r.created_at, 'd MMM yyyy HH:mm')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {requestsQuery.data && requestsQuery.data.pagination.totalPages > 1 && (
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
                หน้า {requestsQuery.data.pagination.page} / {requestsQuery.data.pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={page >= requestsQuery.data.pagination.totalPages}
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
