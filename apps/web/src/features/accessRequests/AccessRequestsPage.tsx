import { DataTable, TablePagination } from '../../components/table/DataTable';
import { useTableParams } from '../../hooks/useTableParams';
import { ExportCsvButton } from '../../components/table/ExportCsvButton';
import { RowActions } from '../../components/table/RowActions';
import { FormModal } from '../../components/ui/Modal';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, KeyRound, Loader2, Plus, ShieldX, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { PaginatedResult } from '../../types/admin';
import type { AccessRequestListItem, AccessRequestStatus, AccessSystem } from '../../types/accessRequests';
import { formatThaiDate } from '../../utils/date';

const REQUEST_STATUSES: AccessRequestStatus[] = ['รออนุมัติจากหัวหน้างาน', 'รอส่วนงานไอทีดำเนินการ', 'เสร็จสิ้น', 'ปฏิเสธ'];

const statusTone: Record<AccessRequestStatus, 'warning' | 'info' | 'success' | 'danger'> = {
  รออนุมัติจากหัวหน้างาน: 'warning',
  รอส่วนงานไอทีดำเนินการ: 'info',
  เสร็จสิ้น: 'success',
  ปฏิเสธ: 'danger',
};

function StatusBadge({ status }: { status: AccessRequestStatus }) {
  return <Badge variant={statusTone[status]}>{status}</Badge>;
}

const submitSchema = z.object({
  systemId: z.string().min(1, 'กรุณาเลือกระบบงาน'),
  accessLevel: z.enum(['Standard', 'Admin']),
  requestType: z.enum(['ขอเพิ่มสิทธิ์', 'เพิกถอนสิทธิ์']),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล'),
});

type SubmitForm = z.infer<typeof submitSchema>;

function SubmitAccessRequestForm({ systems, onClose }: { systems: AccessSystem[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SubmitForm>({ resolver: zodResolver(submitSchema), defaultValues: { requestType: 'ขอเพิ่มสิทธิ์' } });

  const mutation = useMutation({
    mutationFn: (values: SubmitForm) => apiFetch('/api/v1/access-requests', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['access-requests'] });
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
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">ยื่นคำขอสิทธิ์ระบบ</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div>
        <label htmlFor="ar-system" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ระบบงาน
        </label>
        <select
          id="ar-system"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('systemId')}
        >
          <option value="">— เลือกระบบงาน —</option>
          {systems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {errors.systemId && <p className="mt-1 text-xs text-red-600">{errors.systemId.message}</p>}
      </div>

      <div>
        <label htmlFor="ar-level" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ระดับสิทธิ์
        </label>
        <select
          id="ar-level"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('accessLevel')}
        >
          <option value="Standard">Standard (ผู้ใช้งานทั่วไป)</option>
          <option value="Admin">Admin (ผู้ดูแล)</option>
        </select>
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="ar-type" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ประเภทคำขอ
        </label>
        <select
          id="ar-type"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('requestType')}
        >
          <option value="ขอเพิ่มสิทธิ์">ขอเพิ่มสิทธิ์</option>
          <option value="เพิกถอนสิทธิ์">เพิกถอนสิทธิ์</option>
        </select>
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="ar-reason" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          เหตุผล
        </label>
        <textarea
          id="ar-reason"
          rows={3}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('reason')}
        />
        {errors.reason && <p className="mt-1 text-xs text-red-600">{errors.reason.message}</p>}
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

export function AccessRequestsPage() {
  const { me, hasPermission } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const table = useTableParams<'status' | 'mine' | 'pendingMyApproval'>({ filters: ['status', 'mine', 'pendingMyApproval'] });
  const { page, pageSize } = table;
  const { status } = table.filters;
  const mineOnly = table.filters.mine === 'true';
  const pendingApprovalOnly = table.filters.pendingMyApproval === 'true';

  const systemsQuery = useQuery({
    queryKey: ['access-systems'],
    queryFn: () => apiFetch<AccessSystem[]>('/api/v1/access-systems'),
  });

  const requestsQuery = useQuery({
    queryKey: ['access-requests', page, pageSize, status, mineOnly, pendingApprovalOnly],
    queryFn: () =>
      apiFetch<PaginatedResult<AccessRequestListItem>>(
        `/api/v1/access-requests?page=${page}&pageSize=${pageSize}${status ? `&status=${encodeURIComponent(status)}` : ''}${mineOnly ? '&mine=true' : ''}${pendingApprovalOnly ? '&pendingMyApproval=true' : ''}`,
      ),
  });

  const activeSystems = (systemsQuery.data ?? []).filter((s) => s.status === 'active');
  const visibleRequests = requestsQuery.data?.items ?? [];
  const pendingCount = visibleRequests.filter((request) => request.status === 'รออนุมัติจากหัวหน้างาน' || request.status === 'รอส่วนงานไอทีดำเนินการ').length;
  const completedCount = visibleRequests.filter((request) => request.status === 'เสร็จสิ้น').length;
  const rejectedCount = visibleRequests.filter((request) => request.status === 'ปฏิเสธ').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <PageTitle eyebrow="บริการและกระบวนการ IT / คำขอสิทธิ์" title="คำขอสิทธิ์ระบบ" description="ยื่นคำขอสิทธิ์เข้าถึงระบบงาน ผ่านการอนุมัติของหัวหน้างานและไอที" />
        {hasPermission('access_request.create') && (
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            ยื่นคำขอใหม่
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={<KeyRound className="h-5 w-5" />} label="คำขอทั้งหมด" value={requestsQuery.data?.pagination.totalItems ?? 0} tone="primary" />
        <StatCard icon={<Clock3 className="h-5 w-5" />} label="กำลังรอดำเนินการ (หน้านี้)" value={pendingCount} tone={pendingCount ? 'amber' : 'gray'} />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="เสร็จสิ้น (หน้านี้)" value={completedCount} tone="teal" />
        <StatCard icon={<ShieldX className="h-5 w-5" />} label="ปฏิเสธ (หน้านี้)" value={rejectedCount} tone={rejectedCount ? 'danger' : 'gray'} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <span>รายการคำขอสิทธิ์</span>
          <div className="flex flex-wrap items-center gap-2 text-xs font-normal">
            <button
              type="button"
              onClick={() => {
                table.setFilter('mine', mineOnly ? '' : 'true');
              }}
              className={`rounded-full px-3 py-1 ${mineOnly ? 'bg-primary-700 text-white' : 'border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}
            >
              ของฉันเท่านั้น
            </button>
            <button
              type="button"
              onClick={() => {
                table.setFilter('pendingMyApproval', pendingApprovalOnly ? '' : 'true');
              }}
              className={`rounded-full px-3 py-1 ${pendingApprovalOnly ? 'bg-primary-700 text-white' : 'border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}
            >
              รอฉันอนุมัติ
            </button>
            <select
              value={status}
              onChange={(e) => {
                table.setFilter('status', e.target.value);
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
            <ExportCsvButton
              disabled={!requestsQuery.data?.items.length}
              fileName={`access-requests-page-${page}.csv`}
              getRows={() => [
                ['ระบบงาน', 'ระดับสิทธิ์', 'ประเภท', 'สถานะ', 'ยื่นเมื่อ'],
                ...(requestsQuery.data?.items ?? []).map((r) => [
                  r.access_systems?.name ?? '',
                  r.access_level,
                  r.request_type,
                  r.status,
                  formatThaiDate(r.created_at, 'd MMM yyyy HH:mm'),
                ]),
              ]}
            />
          </div>
        </CardHeader>
        <CardBody>
          {showCreate && <FormModal title="ยื่นคำขอสิทธิ์ระบบ" description="ระบุระบบและระดับสิทธิ์ที่ต้องการ" size="lg" onClose={() => setShowCreate(false)}><SubmitAccessRequestForm systems={activeSystems} onClose={() => setShowCreate(false)} /></FormModal>}

          {requestsQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}

          {requestsQuery.data && requestsQuery.data.items.length === 0 && (
            <EmptyState icon={<KeyRound className="h-10 w-10" aria-hidden="true" />} title="ไม่พบคำขอสิทธิ์ระบบ" />
          )}

          {requestsQuery.data && requestsQuery.data.items.length > 0 && (
            <div className="overflow-x-auto">
              <DataTable mode="server" rowNumberStart={(page - 1) * pageSize + 1} className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">ระบบงาน</th>
                    <th className="px-2 py-2">ระดับ</th>
                    <th className="px-2 py-2">ประเภท</th>
                    <th className="px-2 py-2">สถานะ</th>
                    <th className="px-2 py-2">ยื่นเมื่อ</th>
                    <th className="px-2 py-2 text-right">ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody>
                  {requestsQuery.data.items.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-2 py-2">
                        <Link to={`/access-requests/${r.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
                          {r.access_systems?.name ?? '—'}
                        </Link>
                        {r.requester_id === me?.profile.id && <span className="ml-1 text-xs text-slate-400">(ของฉัน)</span>}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant="secondary">{r.access_level}</Badge>
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{r.request_type}</td>
                      <td className="px-2 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{formatThaiDate(r.created_at, 'd MMM yyyy HH:mm')}</td>
                      <td className="px-2 py-2 text-right">
                        <RowActions recordLabel={r.access_systems?.name ?? 'คำขอสิทธิ์'} actions={[{ kind: 'view', to: `/access-requests/${r.id}` }]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          )}

          {requestsQuery.data && <TablePagination page={requestsQuery.data.pagination.page} pageSize={pageSize} totalItems={requestsQuery.data.pagination.totalItems} totalPages={requestsQuery.data.pagination.totalPages} onPageChange={table.setPage} onPageSizeChange={table.setPageSize} />}
        </CardBody>
      </Card>
    </div>
  );
}
