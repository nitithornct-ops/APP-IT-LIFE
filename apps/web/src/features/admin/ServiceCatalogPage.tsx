import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { ApprovalGroup, Department, PaginatedResult } from '../../types/admin';
import type { ServiceCatalogItem, ServiceCatalogStatus } from '../../types/serviceCatalog';

const statusLabel: Record<ServiceCatalogStatus, string> = {
  draft: 'ร่าง',
  active: 'ใช้งาน',
  suspended: 'ระงับ',
  retired: 'ยกเลิก',
};

const statusTone: Record<ServiceCatalogStatus, 'secondary' | 'success' | 'warning' | 'danger'> = {
  draft: 'secondary',
  active: 'success',
  suspended: 'warning',
  retired: 'danger',
};

const catalogSchema = z
  .object({
    serviceCode: z.string().trim().min(1, 'กรุณาระบุรหัสบริการ'),
    serviceName: z.string().trim().min(1, 'กรุณาระบุชื่อบริการ'),
    category: z.string().trim().optional(),
    description: z.string().trim().optional(),
    // ปล่อยว่างไว้ = ใช้ค่าเริ่มต้นของ Backend (24 ชม.) — ถ้าใช้ z.coerce.number() เฉยๆ ค่าว่าง ""
    // จาก input จะถูก coerce เป็น 0 แล้วชน .positive() จน validation fail แบบไม่มี error ให้เห็น
    slaHours: z
      .union([z.literal(''), z.coerce.number().positive()])
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
    approvalMode: z.enum(['none', 'group']),
    approvalGroupId: z.string().optional(),
    fulfillmentGroupId: z.string().optional(),
    closeMode: z.enum(['requester_confirms', 'it_closes']),
    notes: z.string().trim().optional(),
  })
  .refine((v) => v.approvalMode !== 'group' || !!v.approvalGroupId, {
    message: 'กรุณาเลือกกลุ่มอนุมัติ',
    path: ['approvalGroupId'],
  });

type CatalogForm = z.infer<typeof catalogSchema>;

function CreateCatalogForm({
  approvalGroups,
  departments,
  onClose,
}: {
  approvalGroups: ApprovalGroup[];
  departments: Department[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CatalogForm>({ resolver: zodResolver(catalogSchema), defaultValues: { approvalMode: 'none', closeMode: 'requester_confirms' } });
  const approvalMode = watch('approvalMode');

  const mutation = useMutation({
    mutationFn: (values: CatalogForm) =>
      apiFetch('/api/v1/service-catalog', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          approvalGroupId: values.approvalMode === 'group' ? values.approvalGroupId : undefined,
          fulfillmentGroupId: values.fulfillmentGroupId || undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'service-catalog'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'สร้างบริการไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-900/40"
      noValidate
    >
      <div className="flex items-center justify-between sm:col-span-2">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">เพิ่มบริการใน Catalog</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div>
        <label htmlFor="sc-code" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          รหัสบริการ
        </label>
        <input
          id="sc-code"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('serviceCode')}
        />
        {errors.serviceCode && <p className="mt-1 text-xs text-red-600">{errors.serviceCode.message}</p>}
      </div>

      <div>
        <label htmlFor="sc-name" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ชื่อบริการ
        </label>
        <input
          id="sc-name"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('serviceName')}
        />
        {errors.serviceName && <p className="mt-1 text-xs text-red-600">{errors.serviceName.message}</p>}
      </div>

      <div>
        <label htmlFor="sc-category" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          หมวดหมู่ (ถ้ามี)
        </label>
        <input
          id="sc-category"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('category')}
        />
      </div>

      <div>
        <label htmlFor="sc-sla" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          SLA (ชั่วโมง)
        </label>
        <input
          id="sc-sla"
          type="number"
          min={1}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('slaHours')}
        />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="sc-desc" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          คำอธิบาย
        </label>
        <textarea
          id="sc-desc"
          rows={2}
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('description')}
        />
      </div>

      <div>
        <label htmlFor="sc-approval-mode" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          รูปแบบการอนุมัติ
        </label>
        <select
          id="sc-approval-mode"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('approvalMode')}
        >
          <option value="none">ไม่ต้องอนุมัติ</option>
          <option value="group">ต้องผ่านกลุ่มอนุมัติ</option>
        </select>
      </div>

      {approvalMode === 'group' && (
        <div>
          <label htmlFor="sc-approval-group" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
            กลุ่มอนุมัติ
          </label>
          <select
            id="sc-approval-group"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            {...register('approvalGroupId')}
          >
            <option value="">— เลือกกลุ่มอนุมัติ —</option>
            {approvalGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.code})
              </option>
            ))}
          </select>
          {errors.approvalGroupId && <p className="mt-1 text-xs text-red-600">{errors.approvalGroupId.message}</p>}
        </div>
      )}

      <div>
        <label htmlFor="sc-fulfillment-group" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          หน่วยงานผู้ดำเนินการ (ถ้ามี)
        </label>
        <select
          id="sc-fulfillment-group"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('fulfillmentGroupId')}
        >
          <option value="">— ไม่ระบุ —</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name_th}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="sc-close-mode" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          รูปแบบการปิดงาน
        </label>
        <select
          id="sc-close-mode"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('closeMode')}
        >
          <option value="requester_confirms">ผู้ขอยืนยันก่อนปิดงาน</option>
          <option value="it_closes">IT ปิดงานโดยตรง</option>
        </select>
      </div>

      {serverError && <p className="text-xs text-red-600 sm:col-span-2">{serverError}</p>}

      <div className="sm:col-span-2">
        <Button type="submit" size="sm" isLoading={isSubmitting}>
          บันทึก
        </Button>
      </div>
    </form>
  );
}

export function ServiceCatalogPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const catalogQuery = useQuery({
    queryKey: ['admin', 'service-catalog'],
    queryFn: () => apiFetch<PaginatedResult<ServiceCatalogItem>>('/api/v1/service-catalog?pageSize=100'),
  });

  const approvalGroupsQuery = useQuery({
    queryKey: ['admin', 'approval-groups'],
    queryFn: () => apiFetch<ApprovalGroup[]>('/api/v1/approval-groups'),
  });

  const departmentsQuery = useQuery({
    queryKey: ['admin', 'departments'],
    queryFn: () => apiFetch<Department[]>('/api/v1/departments'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ServiceCatalogStatus }) =>
      apiFetch(`/api/v1/service-catalog/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'service-catalog'] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Service Catalog</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">กำหนดรายการบริการที่พนักงานสามารถขอผ่านระบบได้</p>
        </div>
        <RequirePermission permission="service_catalog.manage">
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            เพิ่มบริการ
          </Button>
        </RequirePermission>
      </div>

      <Card>
        <CardHeader>รายการบริการ</CardHeader>
        <CardBody>
          {showCreate && approvalGroupsQuery.data && departmentsQuery.data && (
            <CreateCatalogForm
              approvalGroups={approvalGroupsQuery.data}
              departments={departmentsQuery.data}
              onClose={() => setShowCreate(false)}
            />
          )}

          {catalogQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}

          {catalogQuery.data && catalogQuery.data.items.length === 0 && (
            <EmptyState icon={<ClipboardList className="h-10 w-10" aria-hidden="true" />} title="ยังไม่มีบริการใน Catalog" />
          )}

          {catalogQuery.data && catalogQuery.data.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">รหัส</th>
                    <th className="px-2 py-2">ชื่อบริการ</th>
                    <th className="px-2 py-2">การอนุมัติ</th>
                    <th className="px-2 py-2">SLA</th>
                    <th className="px-2 py-2">สถานะ</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {catalogQuery.data.items.map((item) => (
                    <tr key={item.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-2 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{item.service_code}</td>
                      <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">{item.service_name}</td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">
                        {item.approval_mode === 'group' ? 'ผ่านกลุ่มอนุมัติ' : 'ไม่ต้องอนุมัติ'}
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{item.sla_hours} ชม.</td>
                      <td className="px-2 py-2">
                        <Badge variant={statusTone[item.status]}>{statusLabel[item.status]}</Badge>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <RequirePermission permission="service_catalog.manage">
                          <select
                            value={item.status}
                            onChange={(e) => statusMutation.mutate({ id: item.id, status: e.target.value as ServiceCatalogStatus })}
                            className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"
                          >
                            {(Object.keys(statusLabel) as ServiceCatalogStatus[]).map((s) => (
                              <option key={s} value={s}>
                                {statusLabel[s]}
                              </option>
                            ))}
                          </select>
                        </RequirePermission>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
