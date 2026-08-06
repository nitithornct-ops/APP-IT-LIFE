import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ListChecks, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { PaginatedResult, UserListItem } from '../../types/admin';
import type { AccessRegistryEntry } from '../../types/accessRequests';
import { formatThaiDate } from '../../utils/date';

function StatusBadge({ status }: { status: AccessRegistryEntry['status'] }) {
  const tone = status === 'active' ? 'success' : status === 'suspended' ? 'warning' : 'secondary';
  const label = status === 'active' ? 'ใช้งาน' : status === 'suspended' ? 'ระงับ (พ้นสภาพ)' : 'เพิกถอนแล้ว';
  return <Badge variant={tone}>{label}</Badge>;
}

function RevokeButton({ entryId }: { entryId: string }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [showInput, setShowInput] = useState(false);

  const mutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/access-registry/${entryId}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'access-registry'] });
      setShowInput(false);
      setReason('');
    },
  });

  if (!showInput) {
    return (
      <button type="button" onClick={() => setShowInput(true)} className="text-xs text-red-600 hover:underline">
        เพิกถอน
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        placeholder="เหตุผล"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-32 rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"
      />
      <button
        type="button"
        disabled={!reason.trim() || mutation.isPending}
        onClick={() => mutation.mutate()}
        className="text-xs text-red-600 hover:underline disabled:opacity-40"
      >
        ยืนยัน
      </button>
      <button type="button" onClick={() => setShowInput(false)} className="text-xs text-slate-400 hover:underline">
        ยกเลิก
      </button>
    </div>
  );
}

function RegistrySection() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['admin', 'access-registry'],
    queryFn: () => apiFetch<AccessRegistryEntry[]>('/api/v1/access-registry'),
  });

  const reviewMutation = useMutation({
    mutationFn: (entryId: string) => apiFetch(`/api/v1/access-registry/${entryId}/review`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'access-registry'] }),
  });

  return (
    <Card>
      <CardHeader>ทะเบียนสิทธิ์ผู้ใช้งาน (RBAC Registry)</CardHeader>
      <CardBody>
        {query.isLoading && (
          <div className="flex justify-center py-8" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
          </div>
        )}

        {query.data && query.data.length === 0 && (
          <EmptyState icon={<ListChecks className="h-10 w-10" aria-hidden="true" />} title="ยังไม่มีรายการสิทธิ์ในทะเบียน" />
        )}

        {query.data && query.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-2">ผู้ใช้</th>
                  <th className="px-2 py-2">ระบบงาน</th>
                  <th className="px-2 py-2">ระดับ</th>
                  <th className="px-2 py-2">รอบทบทวนถัดไป</th>
                  <th className="px-2 py-2">สถานะ</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {query.data.map((entry) => (
                  <tr key={entry.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-2 py-2 text-slate-800 dark:text-slate-200">{entry.user?.full_name ?? '—'}</td>
                    <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{entry.access_systems?.name ?? '—'}</td>
                    <td className="px-2 py-2">
                      <Badge variant="secondary">{entry.access_level}</Badge>
                    </td>
                    <td className="px-2 py-2 text-slate-500 dark:text-slate-400">
                      {entry.next_review_due ? formatThaiDate(entry.next_review_due, 'd MMM yyyy') : '—'}
                    </td>
                    <td className="px-2 py-2">
                      <StatusBadge status={entry.status} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      {entry.status === 'active' && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => reviewMutation.mutate(entry.id)}
                            disabled={reviewMutation.isPending}
                            className="text-xs text-primary-700 hover:underline dark:text-primary-300"
                          >
                            ทบทวนแล้ว
                          </button>
                          <RevokeButton entryId={entry.id} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

const deactivateSchema = z.object({
  userId: z.string().min(1, 'กรุณาเลือกผู้ใช้'),
  reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล'),
});

type DeactivateForm = z.infer<typeof deactivateSchema>;

function DeactivateEmployeeSection() {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DeactivateForm>({ resolver: zodResolver(deactivateSchema) });

  const usersQuery = useQuery({
    queryKey: ['admin', 'users', 'for-deactivate-picker'],
    queryFn: () => apiFetch<PaginatedResult<UserListItem>>('/api/v1/users?page=1&pageSize=100'),
  });

  const mutation = useMutation({
    mutationFn: (values: DeactivateForm) =>
      apiFetch<{ suspendedCount: number }>('/api/v1/access-registry/deactivate', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'access-registry'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setResult(`ระงับบัญชีและสิทธิ์ ${data.suspendedCount} รายการเรียบร้อย`);
      setServerError(null);
      reset();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'ระงับบัญชีไม่สำเร็จ'),
  });

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />
        ระงับสิทธิ์ผู้พ้นสภาพ
      </CardHeader>
      <CardBody>
        <form
          onSubmit={handleSubmit((values) => mutation.mutate(values))}
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          noValidate
        >
          <div>
            <label htmlFor="dea-user" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              ผู้ใช้ที่พ้นสภาพ
            </label>
            <select
              id="dea-user"
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              {...register('userId')}
            >
              <option value="">— เลือกผู้ใช้ —</option>
              {(usersQuery.data?.items ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.email})
                </option>
              ))}
            </select>
            {errors.userId && <p className="mt-1 text-xs text-red-600">{errors.userId.message}</p>}
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="dea-reason" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              เหตุผล
            </label>
            <input
              id="dea-reason"
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              {...register('reason')}
            />
            {errors.reason && <p className="mt-1 text-xs text-red-600">{errors.reason.message}</p>}
          </div>

          {result && <p className="text-xs text-emerald-600 sm:col-span-3">{result}</p>}
          {serverError && <p className="text-xs text-red-600 sm:col-span-3">{serverError}</p>}

          <div className="sm:col-span-3">
            <Button type="submit" size="sm" variant="danger" isLoading={isSubmitting}>
              ระงับบัญชีและสิทธิ์ทั้งหมด
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function AccessRegistryPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">ทะเบียนสิทธิ์ RBAC</h1>
      <p className="-mt-2 text-sm text-slate-500 dark:text-slate-400">ทบทวน/เพิกถอนสิทธิ์ที่ IT ให้ไว้ และระงับสิทธิ์เมื่อพนักงานพ้นสภาพ</p>
      <RegistrySection />
      <DeactivateEmployeeSection />
    </div>
  );
}
