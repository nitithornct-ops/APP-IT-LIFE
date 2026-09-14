import { DataTable, TablePagination } from '../../components/table/DataTable';
import { useTableParams } from '../../hooks/useTableParams';
import { ExportCsvButton } from '../../components/table/ExportCsvButton';
import { RowActions } from '../../components/table/RowActions';
import { FormModal } from '../../components/ui/Modal';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, KeyRound, Loader2, Plus, ShieldX, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import type { AccessAction, AccessControlItem, AccessPersonOption, AccessRequestListItem, AccessRequestStatus, AccessSystem, LifecycleEvent } from '../../types/accessRequests';
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

const ACCESS_ACTIONS: AccessAction[] = ['read', 'create', 'update', 'delete', 'approve'];
const ACTION_LABELS: Record<AccessAction, string> = { read: 'Read', create: 'Create', update: 'Update', delete: 'Delete', approve: 'Approve' };
const lifecycleLabels: Record<LifecycleEvent, string> = { manual: 'คำขอทั่วไป', joiner: 'Joiner — เริ่มงาน', mover: 'Mover — ย้ายบทบาท/หน่วยงาน', leaver: 'Leaver — พ้นสภาพ' };

const submitSchema = z.object({
  systemId: z.string().min(1, 'กรุณาเลือกระบบงาน'),
  accessItemId: z.string().min(1, 'กรุณาเลือก Role / Profile / Group / Entitlement'),
  requestedActions: z.array(z.enum(['read', 'create', 'update', 'delete', 'approve'])).min(1, 'กรุณาเลือกสิทธิ์การทำรายการอย่างน้อย 1 รายการ'),
  temporaryAccess: z.boolean(),
  startAt: z.string().min(1, 'กรุณาระบุวันที่เริ่ม'),
  expiresAt: z.string().optional(),
  businessReason: z.string().trim().min(1, 'กรุณาระบุเหตุผลทางธุรกิจ'),
  requestType: z.enum(['ขอเพิ่มสิทธิ์', 'เพิกถอนสิทธิ์']),
  lifecycleEvent: z.enum(['manual', 'joiner', 'mover', 'leaver']),
  subjectUserId: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.temporaryAccess && !value.expiresAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'Temporary Access ต้องระบุวันหมดอายุ' });
  if (!value.temporaryAccess && value.expiresAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'สิทธิ์ถาวรไม่ควรมีวันหมดอายุ' });
  if (value.lifecycleEvent === 'joiner' && value.requestType === 'เพิกถอนสิทธิ์') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requestType'], message: 'Joiner ต้องเป็นคำขอเพิ่มสิทธิ์' });
  if (value.lifecycleEvent === 'leaver' && value.requestType !== 'เพิกถอนสิทธิ์') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requestType'], message: 'Leaver ต้องเป็นคำขอเพิกถอนสิทธิ์' });
});

type SubmitForm = z.infer<typeof submitSchema>;

function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function SubmitAccessRequestForm({
  systems,
  items,
  people,
  canSelectSubject,
  onClose,
}: {
  systems: AccessSystem[];
  items: AccessControlItem[];
  people: AccessPersonOption[];
  canSelectSubject: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<SubmitForm>({
    resolver: zodResolver(submitSchema),
    defaultValues: {
      requestType: 'ขอเพิ่มสิทธิ์',
      lifecycleEvent: 'manual',
      requestedActions: [],
      temporaryAccess: false,
      startAt: localDateTimeValue(new Date()),
    },
  });

  const selectedSystemId = watch('systemId');
  const selectedItemId = watch('accessItemId');
  const temporaryAccess = watch('temporaryAccess');
  const lifecycleEvent = watch('lifecycleEvent');
  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId && item.system_id === selectedSystemId) ?? null, [items, selectedItemId, selectedSystemId]);
  const systemItems = useMemo(() => items.filter((item) => item.system_id === selectedSystemId && item.status === 'active'), [items, selectedSystemId]);

  useEffect(() => {
    const current = getValues('requestedActions');
    setValue('requestedActions', current.filter((action) => selectedItem?.permission_actions.includes(action) ?? false), { shouldValidate: true });
  }, [getValues, selectedItem, setValue]);

  const mutation = useMutation({
    mutationFn: (values: SubmitForm) => apiFetch('/api/v1/access-requests', {
      method: 'POST',
      body: JSON.stringify({
        ...values,
        startAt: new Date(values.startAt).toISOString(),
        expiresAt: values.temporaryAccess && values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
        subjectUserId: values.subjectUserId || undefined,
      }),
    }),
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

      {canSelectSubject && (
        <div className="sm:col-span-2">
          <label htmlFor="ar-subject" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            ผู้รับสิทธิ์ (JML / ขอแทน)
          </label>
          <select
            id="ar-subject"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            {...register('subjectUserId')}
          >
            <option value="">— ตัวฉันเอง —</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>{person.full_name} ({person.email}){person.status === 'inactive' ? ' · inactive' : ''}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">การยื่นแทนผู้อื่นใช้สำหรับ Joiner / Mover / Leaver และต้องมีสิทธิ์เจ้าหน้าที่</p>
        </div>
      )}

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
        <label htmlFor="ar-item" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          Role / Profile / Group / Entitlement
        </label>
        <select
          id="ar-item"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('accessItemId')}
        >
          <option value="">— เลือกสิทธิ์ที่กำหนดไว้ —</option>
          {systemItems.map((item) => (
            <option key={item.id} value={item.id}>{item.kind.toUpperCase()} · {item.name} ({item.code})</option>
          ))}
        </select>
        {errors.accessItemId && <p className="mt-1 text-xs text-red-600">{errors.accessItemId.message}</p>}
      </div>

      <div>
        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ขอบเขตการทำรายการ</span>
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
          {ACCESS_ACTIONS.map((action) => (
            <label key={action} className={`flex items-center gap-2 text-xs ${selectedItem?.permission_actions.includes(action) ? 'text-slate-700 dark:text-slate-200' : 'text-slate-300 dark:text-slate-600'}`}>
              <input type="checkbox" value={action} disabled={!selectedItem?.permission_actions.includes(action)} {...register('requestedActions')} />
              {ACTION_LABELS[action]}
            </label>
          ))}
        </div>
        {errors.requestedActions && <p className="mt-1 text-xs text-red-600">{errors.requestedActions.message}</p>}
      </div>

      {selectedItem && (
        <div className="sm:col-span-2 grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900 sm:grid-cols-3">
          <div><span className="text-slate-500">Data Classification</span><div className="font-semibold">{selectedItem.data_classification}</div></div>
          <div><span className="text-slate-500">System Owner</span><div className="font-semibold">{selectedItem.system_owner?.full_name ?? 'กำหนดใน master data'}</div></div>
          <div><span className="text-slate-500">Approver</span><div className="font-semibold">{selectedItem.default_approver?.full_name ?? 'หัวหน้างานของผู้รับสิทธิ์'}</div></div>
          {selectedItem.privileged_access && <div className="sm:col-span-3 rounded-md bg-amber-50 p-2 font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">Privileged Access — ต้องใช้ MFA และผู้ดำเนินการต้องแยกจากผู้อนุมัติ</div>}
        </div>
      )}

      <div>
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
        {errors.requestType && <p className="mt-1 text-xs text-red-600">{errors.requestType.message}</p>}
      </div>

      <div>
        <label htmlFor="ar-lifecycle" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          JML / Lifecycle Event
        </label>
        <select
          id="ar-lifecycle"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('lifecycleEvent')}
          onChange={(event) => {
            const next = event.target.value as LifecycleEvent;
            setValue('lifecycleEvent', next, { shouldValidate: true });
            if (next === 'joiner') setValue('requestType', 'ขอเพิ่มสิทธิ์', { shouldValidate: true });
            if (next === 'leaver') setValue('requestType', 'เพิกถอนสิทธิ์', { shouldValidate: true });
          }}
        >
          {Object.entries(lifecycleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {lifecycleEvent === 'leaver' && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Leaver จะเพิกถอนสิทธิ์ของผู้รับสิทธิ์เมื่อ IT ดำเนินการสำเร็จ</p>}
      </div>

      <div>
        <label htmlFor="ar-start" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">วันที่เริ่มมีสิทธิ์</label>
        <input id="ar-start" type="datetime-local" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('startAt')} />
        {errors.startAt && <p className="mt-1 text-xs text-red-600">{errors.startAt.message}</p>}
      </div>

      <div>
        <label className="mb-1 flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <input type="checkbox" {...register('temporaryAccess')} /> Temporary Access
        </label>
        <input id="ar-expires" type="datetime-local" disabled={!temporaryAccess} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:disabled:bg-slate-800" {...register('expiresAt')} />
        {errors.expiresAt && <p className="mt-1 text-xs text-red-600">{errors.expiresAt.message}</p>}
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="ar-reason" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          เหตุผลทางธุรกิจ
        </label>
        <textarea
          id="ar-reason"
          rows={3}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('businessReason')}
        />
        {errors.businessReason && <p className="mt-1 text-xs text-red-600">{errors.businessReason.message}</p>}
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

  const itemsQuery = useQuery({
    queryKey: ['access-control-items'],
    queryFn: () => apiFetch<AccessControlItem[]>('/api/v1/access-control-items'),
  });
  const canSelectSubject = hasPermission('access_request.process') || hasPermission('access_registry.manage') || hasPermission('user.manage');
  const peopleQuery = useQuery({
    queryKey: ['access-request-subject-options'],
    queryFn: () => apiFetch<AccessPersonOption[]>('/api/v1/access-requests/subject-options'),
    enabled: canSelectSubject,
  });

  const requestsQuery = useQuery({
    queryKey: ['access-requests', page, pageSize, status, mineOnly, pendingApprovalOnly],
    queryFn: () =>
      apiFetch<PaginatedResult<AccessRequestListItem>>(
        `/api/v1/access-requests?page=${page}&pageSize=${pageSize}${status ? `&status=${encodeURIComponent(status)}` : ''}${mineOnly ? '&mine=true' : ''}${pendingApprovalOnly ? '&pendingMyApproval=true' : ''}`,
      ),
  });

  const activeSystems = (systemsQuery.data ?? []).filter((s) => s.status === 'active');
  const activeItems = (itemsQuery.data ?? []).filter((item) => item.status === 'active');
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
                ['ระบบงาน', 'Role / Profile / Group / Entitlement', 'Actions', 'Lifecycle', 'ประเภท', 'สถานะ', 'ยื่นเมื่อ'],
                ...(requestsQuery.data?.items ?? []).map((r) => [
                  r.access_systems?.name ?? '',
                  r.access_control_item?.name ?? r.access_level ?? '',
                  r.requested_actions.join(', '),
                  r.lifecycle_event,
                  r.request_type,
                  r.status,
                  formatThaiDate(r.created_at, 'd MMM yyyy HH:mm'),
                ]),
              ]}
            />
          </div>
        </CardHeader>
        <CardBody>
          {showCreate && <FormModal title="ยื่นคำขอสิทธิ์ระบบ" description="เลือกสิทธิ์จาก RBAC catalog และระบุช่วงเวลาการใช้งาน" size="lg" onClose={() => setShowCreate(false)}><SubmitAccessRequestForm systems={activeSystems} items={activeItems} people={peopleQuery.data ?? []} canSelectSubject={canSelectSubject} onClose={() => setShowCreate(false)} /></FormModal>}

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
                    <th className="px-2 py-2">RBAC item / Actions</th>
                    <th className="px-2 py-2">Lifecycle</th>
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
                        <Badge variant="secondary">{r.access_control_item?.name ?? r.access_level ?? '—'}</Badge>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{r.requested_actions.join(', ') || 'legacy'}</div>
                      </td>
                      <td className="px-2 py-2 text-xs text-slate-500 dark:text-slate-400">{lifecycleLabels[r.lifecycle_event]}</td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{r.request_type}</td>
                      <td className="px-2 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{formatThaiDate(r.created_at, 'd MMM yyyy HH:mm')}</td>
                      <td className="px-2 py-2 text-right">
                        <RowActions recordLabel={r.access_systems?.name ?? 'คำขอสิทธิ์'} actions={[
                          { kind: 'view', to: `/access-requests/${r.id}` },
                          { kind: 'delete', permission: 'access_request.process', deleteEndpoint: `/api/v1/record-deletions/access-requests/${r.id}` },
                        ]} />
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
