import { DataTable } from '../../components/table/DataTable';
import { ExportCsvButton } from '../../components/table/ExportCsvButton';
import { FormModal } from '../../components/ui/Modal';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Database, FileUp, FolderTree, GitMerge, History, KeyRound, Loader2, LockKeyhole, Plus, Search, Tags, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { RowActions } from '../../components/table/RowActions';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import { sortNewestFirst } from '../../utils/recordOrder';
import type { AssetCategory, TicketCategory } from '../../types/admin';
import type { AccessAction, AccessControlItem, AccessPersonOption, AccessSystem, DataClassification } from '../../types/accessRequests';
import type { MasterDataAuditItem, MasterDataKind, MasterDataRegistryItem } from '../../types/masterData';
import { parseMasterDataCsv, type ParsedMasterDataCsvRow } from './masterDataCsv';
import { CauseCodesSection } from './CauseCodesSection';

const TICKET_PRIORITIES = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'] as const;

const priorityTone: Record<(typeof TICKET_PRIORITIES)[number], 'secondary' | 'info' | 'warning' | 'danger'> = {
  ต่ำ: 'secondary',
  ปานกลาง: 'info',
  สูง: 'warning',
  วิกฤต: 'danger',
};

function StatusBadge({ status }: { status: 'active' | 'inactive' }) {
  return <Badge variant={status === 'active' ? 'success' : 'secondary'}>{status === 'active' ? 'ใช้งาน' : 'ระงับ'}</Badge>;
}

function useToggleStatus(resource: 'ticket-categories' | 'asset-categories' | 'access-systems', queryKey: string[]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' }) =>
      apiFetch(`/api/v1/${resource}/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  });
}

const ticketCategorySchema = z.object({
  code: z.string().trim().min(2, 'กรุณาระบุ Code อย่างน้อย 2 ตัวอักษร').regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'ใช้ A-Z, ตัวเลข, - หรือ _ เท่านั้น'),
  name: z.string().trim().min(1, 'กรุณากรอกชื่อหมวดหมู่'),
  defaultPriority: z.enum(TICKET_PRIORITIES).optional(),
  responseSlaHours: z.coerce.number().positive().optional().or(z.literal('').transform(() => undefined)),
  resolutionSlaHours: z.coerce.number().positive().optional().or(z.literal('').transform(() => undefined)),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ใช้รูปแบบ YYYY-MM-DD').or(z.literal('')),
  sortOrder: z.coerce.number().int().min(0).max(9999),
});

type TicketCategoryForm = z.infer<typeof ticketCategorySchema>;

function CreateTicketCategoryForm({ category, onClose }: { category?: TicketCategory; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TicketCategoryForm>({
    resolver: zodResolver(ticketCategorySchema),
    defaultValues: {
      name: category?.name ?? '',
      code: category?.code ?? '',
      defaultPriority: category?.default_priority ?? 'ปานกลาง',
      responseSlaHours: category?.response_sla_hours ?? undefined,
      resolutionSlaHours: category?.resolution_sla_hours ?? undefined,
      effectiveDate: category?.effective_date ?? new Date().toISOString().slice(0, 10),
      sortOrder: category?.sort_order ?? 100,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: TicketCategoryForm) => {
      const body = category
        ? {
            ...values,
            effectiveDate: values.effectiveDate || undefined,
            responseSlaHours: values.responseSlaHours ?? null,
            resolutionSlaHours: values.resolutionSlaHours ?? null,
          }
        : values;
      return apiFetch(category ? `/api/v1/ticket-categories/${category.id}` : '/api/v1/ticket-categories', {
        method: category ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'ticket-categories'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'cause-codes'] });
      void queryClient.invalidateQueries({ queryKey: ['cause-codes'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'สร้างหมวดหมู่ไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-900/40"
      noValidate
    >
      <div className="flex items-center justify-between sm:col-span-2">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{category ? 'แก้ไขหมวดหมู่ Ticket' : 'เพิ่มหมวดหมู่ Ticket'}</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div>
        <label htmlFor="tc-code" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          Code
        </label>
        <input id="tc-code" disabled={Boolean(category)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-sm uppercase dark:border-slate-600 dark:bg-slate-900" {...register('code')} />
        {category && <p className="mt-1 text-[10px] text-slate-400">Code แก้ไม่ได้เพื่อคงความหมายของข้อมูลย้อนหลัง</p>}
        {errors.code && <p className="mt-1 text-xs text-red-600">{errors.code.message}</p>}
      </div>

      <div>
        <label htmlFor="tc-name" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ชื่อหมวดหมู่
        </label>
        <input
          id="tc-name"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('name')}
        />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>

      <div>
        <label htmlFor="tc-effective-date" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Effective Date</label>
        <input id="tc-effective-date" type="date" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('effectiveDate')} />
        {errors.effectiveDate && <p className="mt-1 text-xs text-red-600">{errors.effectiveDate.message}</p>}
      </div>

      <div>
        <label htmlFor="tc-sort-order" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Sort Order</label>
        <input id="tc-sort-order" type="number" min={0} step={1} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('sortOrder')} />
      </div>

      <div>
        <label htmlFor="tc-priority" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ความสำคัญเริ่มต้น
        </label>
        <select
          id="tc-priority"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('defaultPriority')}
        >
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="tc-response" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          Response SLA (ชั่วโมง)
        </label>
        <input
          id="tc-response"
          type="number"
          min={0}
          step="0.5"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('responseSlaHours')}
        />
      </div>

      <div>
        <label htmlFor="tc-resolution" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          Resolution SLA (ชั่วโมง)
        </label>
        <input
          id="tc-resolution"
          type="number"
          min={0}
          step="0.5"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('resolutionSlaHours')}
        />
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

function TicketCategoriesSection() {
  const [showCreate, setShowCreate] = useState(false);
  const [editingCategory, setEditingCategory] = useState<TicketCategory | null>(null);
  const query = useQuery({
    queryKey: ['admin', 'ticket-categories'],
    queryFn: () => apiFetch<TicketCategory[]>('/api/v1/ticket-categories'),
  });
  const toggleStatus = useToggleStatus('ticket-categories', ['admin', 'ticket-categories']);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <span>หมวดหมู่ Ticket และ SLA ตั้งต้น</span>
        <RequirePermission permission="ticket_category.manage">
          <Button size="sm" variant="outline" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            เพิ่มหมวดหมู่
          </Button>
        </RequirePermission>
      </CardHeader>
      <CardBody>
        {showCreate && <FormModal title="เพิ่มหมวดหมู่ Ticket" size="md" onClose={() => setShowCreate(false)}><CreateTicketCategoryForm onClose={() => setShowCreate(false)} /></FormModal>}
        {editingCategory && <FormModal title="แก้ไขหมวดหมู่ Ticket" size="md" onClose={() => setEditingCategory(null)}><CreateTicketCategoryForm category={editingCategory} onClose={() => setEditingCategory(null)} /></FormModal>}

        {query.isLoading && (
          <div className="flex justify-center py-8" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
          </div>
        )}

        {query.data && query.data.length === 0 && (
          <EmptyState icon={<Tags className="h-10 w-10" aria-hidden="true" />} title="ยังไม่มีหมวดหมู่ Ticket" />
        )}

        {query.data && query.data.length > 0 && (
          <div className="overflow-x-auto">
            <DataTable className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-2">Code</th>
                  <th className="px-2 py-2">ชื่อหมวดหมู่</th>
                  <th className="px-2 py-2">ความสำคัญเริ่มต้น</th>
                  <th className="px-2 py-2">Response SLA</th>
                  <th className="px-2 py-2">Resolution SLA</th>
                  <th className="px-2 py-2">สถานะ</th>
                  <th className="px-2 py-2">Effective / Sort</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {sortNewestFirst(query.data).map((cat) => (
                  <tr key={cat.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-2 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{cat.code}</td>
                    <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">{cat.name}</td>
                    <td className="px-2 py-2">
                      <Badge variant={priorityTone[cat.default_priority]}>{cat.default_priority}</Badge>
                    </td>
                    <td className="px-2 py-2 text-slate-500 dark:text-slate-400">
                      {cat.response_sla_hours ? `${cat.response_sla_hours} ชม.` : '—'}
                    </td>
                    <td className="px-2 py-2 text-slate-500 dark:text-slate-400">
                      {cat.resolution_sla_hours ? `${cat.resolution_sla_hours} ชม.` : '—'}
                    </td>
                    <td className="px-2 py-2">
                      <StatusBadge status={cat.status} />
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500 dark:text-slate-400"><div>{cat.effective_date}</div><div>#{cat.sort_order}</div></td>
                    <td className="px-2 py-2 text-right">
                      <RowActions recordLabel={cat.name} actions={[
                        { kind: 'edit', permission: 'ticket_category.manage', onClick: () => setEditingCategory(cat) },
                        { kind: 'custom', icon: cat.status === 'active' ? Ban : CheckCircle2, label: cat.status === 'active' ? 'ระงับ' : 'เปิดใช้งาน', permission: 'ticket_category.manage', onClick: () => toggleStatus.mutate({ id: cat.id, status: cat.status === 'active' ? 'inactive' : 'active' }) },
                      ]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

const assetCategorySchema = z.object({
  code: z.string().trim().min(2, 'กรุณาระบุ Code อย่างน้อย 2 ตัวอักษร').regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'ใช้ A-Z, ตัวเลข, - หรือ _ เท่านั้น'),
  name: z.string().trim().min(1, 'กรุณากรอกชื่อหมวดหมู่'),
  codePrefix: z
    .string()
    .trim()
    .min(1, 'กรุณากรอกคำนำหน้ารหัส')
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, 'ใช้ตัวอักษร A-Z, ตัวเลข, - เท่านั้น'),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ใช้รูปแบบ YYYY-MM-DD').or(z.literal('')),
  sortOrder: z.coerce.number().int().min(0).max(9999),
});

type AssetCategoryForm = z.infer<typeof assetCategorySchema>;

function CreateAssetCategoryForm({ category, onClose }: { category?: AssetCategory; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AssetCategoryForm>({
    resolver: zodResolver(assetCategorySchema),
    defaultValues: {
      code: category?.code ?? category?.code_prefix ?? '',
      name: category?.name ?? '',
      codePrefix: category?.code_prefix ?? '',
      effectiveDate: category?.effective_date ?? new Date().toISOString().slice(0, 10),
      sortOrder: category?.sort_order ?? 100,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: AssetCategoryForm) =>
      apiFetch(category ? `/api/v1/asset-categories/${category.id}` : '/api/v1/asset-categories', {
        method: category ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...values, effectiveDate: values.effectiveDate || undefined }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'asset-categories'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'สร้างหมวดหมู่ไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-900/40"
      noValidate
    >
      <div className="flex items-center justify-between sm:col-span-2">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{category ? 'แก้ไขหมวดหมู่ทรัพย์สิน' : 'เพิ่มหมวดหมู่ทรัพย์สิน'}</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div>
        <label htmlFor="ac-code" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Code</label>
        <input id="ac-code" disabled={Boolean(category)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-sm uppercase dark:border-slate-600 dark:bg-slate-900" {...register('code')} />
        {category && <p className="mt-1 text-[10px] text-slate-400">Code แก้ไม่ได้เพื่อคงความหมายของข้อมูลย้อนหลัง</p>}
        {errors.code && <p className="mt-1 text-xs text-red-600">{errors.code.message}</p>}
      </div>

      <div>
        <label htmlFor="ac-name" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ชื่อหมวดหมู่
        </label>
        <input
          id="ac-name"
          placeholder="เช่น โน้ตบุ๊ก"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('name')}
        />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>

      <div>
        <label htmlFor="ac-effective-date" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Effective Date</label>
        <input id="ac-effective-date" type="date" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('effectiveDate')} />
      </div>

      <div>
        <label htmlFor="ac-sort-order" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Sort Order</label>
        <input id="ac-sort-order" type="number" min={0} step={1} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('sortOrder')} />
      </div>

      <div>
        <label htmlFor="ac-prefix" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          คำนำหน้ารหัสทรัพย์สิน
        </label>
        <input
          id="ac-prefix"
          placeholder="เช่น NB"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm uppercase dark:border-slate-600 dark:bg-slate-900"
          {...register('codePrefix')}
        />
        {errors.codePrefix && <p className="mt-1 text-xs text-red-600">{errors.codePrefix.message}</p>}
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

function AssetCategoriesSection() {
  const [showCreate, setShowCreate] = useState(false);
  const [editingCategory, setEditingCategory] = useState<AssetCategory | null>(null);
  const query = useQuery({
    queryKey: ['admin', 'asset-categories'],
    queryFn: () => apiFetch<AssetCategory[]>('/api/v1/asset-categories'),
  });
  const toggleStatus = useToggleStatus('asset-categories', ['admin', 'asset-categories']);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <span>หมวดหมู่ทรัพย์สิน</span>
        <RequirePermission permission="asset_category.manage">
          <Button size="sm" variant="outline" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            เพิ่มหมวดหมู่
          </Button>
        </RequirePermission>
      </CardHeader>
      <CardBody>
        {showCreate && <FormModal title="เพิ่มหมวดหมู่ทรัพย์สิน" size="md" onClose={() => setShowCreate(false)}><CreateAssetCategoryForm onClose={() => setShowCreate(false)} /></FormModal>}
        {editingCategory && <FormModal title="แก้ไขหมวดหมู่ทรัพย์สิน" size="md" onClose={() => setEditingCategory(null)}><CreateAssetCategoryForm category={editingCategory} onClose={() => setEditingCategory(null)} /></FormModal>}

        {query.isLoading && (
          <div className="flex justify-center py-8" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
          </div>
        )}

        {query.data && query.data.length === 0 && (
          <EmptyState icon={<Tags className="h-10 w-10" aria-hidden="true" />} title="ยังไม่มีหมวดหมู่ทรัพย์สิน" />
        )}

        {query.data && query.data.length > 0 && (
          <div className="overflow-x-auto">
            <DataTable className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-2">Code</th>
                  <th className="px-2 py-2">ชื่อหมวดหมู่</th>
                  <th className="px-2 py-2">คำนำหน้ารหัส</th>
                  <th className="px-2 py-2">สถานะ</th>
                  <th className="px-2 py-2">Effective / Sort</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {sortNewestFirst(query.data).map((cat) => (
                  <tr key={cat.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-2 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{cat.code}</td>
                    <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">{cat.name}</td>
                    <td className="px-2 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{cat.code_prefix}</td>
                    <td className="px-2 py-2">
                      <StatusBadge status={cat.status} />
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500 dark:text-slate-400"><div>{cat.effective_date}</div><div>#{cat.sort_order}</div></td>
                    <td className="px-2 py-2 text-right">
                      <RowActions
                        recordLabel={cat.name}
                        actions={[
                          { kind: 'edit', permission: 'asset_category.manage', onClick: () => setEditingCategory(cat) },
                          {
                            kind: 'custom',
                            icon: cat.status === 'active' ? Ban : CheckCircle2,
                            label: cat.status === 'active' ? 'ระงับ' : 'เปิดใช้งาน',
                            permission: 'asset_category.manage',
                            onClick: () => toggleStatus.mutate({ id: cat.id, status: cat.status === 'active' ? 'inactive' : 'active' }),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

const accessSystemSchema = z.object({
  code: z.string().trim().min(2, 'กรุณาระบุ Code อย่างน้อย 2 ตัวอักษร').regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'ใช้ A-Z, ตัวเลข, - หรือ _ เท่านั้น'),
  name: z.string().trim().min(1, 'กรุณากรอกชื่อระบบงาน'),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ใช้รูปแบบ YYYY-MM-DD').or(z.literal('')),
  sortOrder: z.coerce.number().int().min(0).max(9999),
});

type AccessSystemForm = z.infer<typeof accessSystemSchema>;

function CreateAccessSystemForm({ system, onClose }: { system?: AccessSystem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AccessSystemForm>({
    resolver: zodResolver(accessSystemSchema),
    defaultValues: { code: system?.code ?? '', name: system?.name ?? '', effectiveDate: system?.effective_date ?? new Date().toISOString().slice(0, 10), sortOrder: system?.sort_order ?? 100 },
  });

  const mutation = useMutation({
    mutationFn: (values: AccessSystemForm) =>
      apiFetch(system ? `/api/v1/access-systems/${system.id}` : '/api/v1/access-systems', {
        method: system ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...values, effectiveDate: values.effectiveDate || undefined }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'access-systems'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'สร้างระบบงานไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-900/40"
      noValidate
    >
      <div className="flex items-center justify-between sm:col-span-2">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{system ? 'แก้ไขระบบงาน' : 'เพิ่มระบบงาน'}</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div>
        <label htmlFor="as-code" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Code</label>
        <input id="as-code" disabled={Boolean(system)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-sm uppercase dark:border-slate-600 dark:bg-slate-900" {...register('code')} />
        {system && <p className="mt-1 text-[10px] text-slate-400">Code แก้ไม่ได้เพื่อคงความหมายของข้อมูลย้อนหลัง</p>}
        {errors.code && <p className="mt-1 text-xs text-red-600">{errors.code.message}</p>}
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="as-name" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ชื่อระบบงาน
        </label>
        <input
          id="as-name"
          placeholder="เช่น Google Workspace"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('name')}
        />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>

      <div>
        <label htmlFor="as-effective-date" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Effective Date</label>
        <input id="as-effective-date" type="date" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('effectiveDate')} />
        {errors.effectiveDate && <p className="mt-1 text-xs text-red-600">{errors.effectiveDate.message}</p>}
      </div>

      <div>
        <label htmlFor="as-sort-order" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Sort Order</label>
        <input id="as-sort-order" type="number" min={0} step={1} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('sortOrder')} />
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

function AccessSystemsSection() {
  const [showCreate, setShowCreate] = useState(false);
  const [editingSystem, setEditingSystem] = useState<AccessSystem | null>(null);
  const query = useQuery({
    queryKey: ['admin', 'access-systems'],
    queryFn: () => apiFetch<AccessSystem[]>('/api/v1/access-systems'),
  });
  const toggleStatus = useToggleStatus('access-systems', ['admin', 'access-systems']);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <span>ระบบงานที่ขอสิทธิ์ได้</span>
        <RequirePermission permission="access_system.manage">
          <Button size="sm" variant="outline" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            เพิ่มระบบงาน
          </Button>
        </RequirePermission>
      </CardHeader>
      <CardBody>
        {showCreate && <FormModal title="เพิ่มระบบงาน" description="สร้างข้อมูลระบบสำหรับคำขอสิทธิ์" size="md" onClose={() => setShowCreate(false)}><CreateAccessSystemForm onClose={() => setShowCreate(false)} /></FormModal>}
        {editingSystem && <FormModal title="แก้ไขระบบงาน" description="แก้ไขข้อมูลระบบสำหรับคำขอสิทธิ์" size="md" onClose={() => setEditingSystem(null)}><CreateAccessSystemForm system={editingSystem} onClose={() => setEditingSystem(null)} /></FormModal>}

        {query.isLoading && (
          <div className="flex justify-center py-8" role="status">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
          </div>
        )}

        {query.data && query.data.length === 0 && (
          <EmptyState icon={<Tags className="h-10 w-10" aria-hidden="true" />} title="ยังไม่มีระบบงาน" />
        )}

        {query.data && query.data.length > 0 && (
          <div className="overflow-x-auto">
            <DataTable className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-2">Code</th>
                  <th className="px-2 py-2">ชื่อระบบงาน</th>
                  <th className="px-2 py-2">สถานะ</th>
                  <th className="px-2 py-2">Effective / Sort</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {sortNewestFirst(query.data).map((system) => (
                  <tr key={system.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-2 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{system.code}</td>
                    <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">{system.name}</td>
                    <td className="px-2 py-2">
                      <StatusBadge status={system.status} />
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500 dark:text-slate-400"><div>{system.effective_date}</div><div>#{system.sort_order}</div></td>
                    <td className="px-2 py-2 text-right">
                      <RowActions recordLabel={system.name} actions={[
                        { kind: 'edit', permission: 'access_system.manage', onClick: () => setEditingSystem(system) },
                        { kind: 'custom', icon: system.status === 'active' ? Ban : CheckCircle2, label: system.status === 'active' ? 'ระงับ' : 'เปิดใช้งาน', permission: 'access_system.manage', onClick: () => toggleStatus.mutate({ id: system.id, status: system.status === 'active' ? 'inactive' : 'active' }) },
                      ]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

const ACCESS_ITEM_ACTIONS: AccessAction[] = ['read', 'create', 'update', 'delete', 'approve'];
const ACCESS_ITEM_KINDS = ['role', 'profile', 'group', 'entitlement'] as const;
const ACCESS_ITEM_CLASSIFICATIONS: DataClassification[] = ['ไม่ลับ', 'ลับ', 'ลับมาก'];

const accessControlItemSchema = z.object({
  systemId: z.string().min(1, 'กรุณาเลือกระบบงาน'),
  kind: z.enum(ACCESS_ITEM_KINDS),
  code: z.string().trim().min(1, 'กรุณาระบุรหัสสิทธิ์'),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อสิทธิ์'),
  description: z.string().trim().optional(),
  permissionActions: z.array(z.enum(ACCESS_ITEM_ACTIONS as [AccessAction, ...AccessAction[]])).min(1, 'กรุณาเลือก action อย่างน้อย 1 รายการ'),
  dataClassification: z.enum(ACCESS_ITEM_CLASSIFICATIONS as [DataClassification, ...DataClassification[]]),
  privilegedAccess: z.boolean(),
  systemOwnerId: z.string().min(1, 'กรุณาเลือก System Owner'),
  defaultApproverId: z.string().optional(),
});

type AccessControlItemForm = z.infer<typeof accessControlItemSchema>;

function CreateAccessControlItemForm({
  systems,
  people,
  item,
  onClose,
}: {
  systems: AccessSystem[];
  people: AccessPersonOption[];
  item?: AccessControlItem;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<AccessControlItemForm>({
    resolver: zodResolver(accessControlItemSchema),
    defaultValues: {
      systemId: item?.system_id ?? '',
      kind: item?.kind ?? 'role',
      code: item?.code ?? '',
      name: item?.name ?? '',
      description: item?.description ?? '',
      permissionActions: item?.permission_actions ?? ['read'],
      dataClassification: item?.data_classification ?? 'ไม่ลับ',
      privilegedAccess: item?.privileged_access ?? false,
      systemOwnerId: item?.system_owner_id ?? '',
      defaultApproverId: item?.default_approver_id ?? '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: AccessControlItemForm) => apiFetch(item ? `/api/v1/access-control-items/${item.id}` : '/api/v1/access-control-items', {
      method: item ? 'PATCH' : 'POST',
      body: JSON.stringify({
        ...values,
        description: values.description || null,
        defaultApproverId: values.defaultApproverId || null,
      }),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'access-control-items'] });
      void queryClient.invalidateQueries({ queryKey: ['access-control-items'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'บันทึก RBAC item ไม่สำเร็จ'),
  });

  return (
    <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-900/40" noValidate>
      <div className="flex items-center justify-between sm:col-span-2">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{item ? 'แก้ไข RBAC item' : 'เพิ่ม RBAC item'}</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div>
        <label htmlFor="aci-system" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ระบบงาน</label>
        <select id="aci-system" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('systemId')}>
          <option value="">— เลือกระบบงาน —</option>
          {systems.map((system) => <option key={system.id} value={system.id}>{system.name}</option>)}
        </select>
        {errors.systemId && <p className="mt-1 text-xs text-red-600">{errors.systemId.message}</p>}
      </div>
      <div>
        <label htmlFor="aci-kind" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ชนิด</label>
        <select id="aci-kind" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('kind')}>
          <option value="role">Role</option><option value="profile">Profile</option><option value="group">Group</option><option value="entitlement">Entitlement</option>
        </select>
      </div>
      <div>
        <label htmlFor="aci-code" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">รหัสสิทธิ์</label>
        <input id="aci-code" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('code')} />
        {errors.code && <p className="mt-1 text-xs text-red-600">{errors.code.message}</p>}
      </div>
      <div>
        <label htmlFor="aci-name" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ชื่อสิทธิ์</label>
        <input id="aci-name" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('name')} />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>

      <div className="sm:col-span-2">
        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Actions ที่ item นี้อนุญาต</span>
        <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
          {ACCESS_ITEM_ACTIONS.map((action) => <label key={action} className="flex items-center gap-1.5 text-xs"><input type="checkbox" value={action} {...register('permissionActions')} />{action}</label>)}
        </div>
        {errors.permissionActions && <p className="mt-1 text-xs text-red-600">{errors.permissionActions.message}</p>}
      </div>
      <div>
        <label htmlFor="aci-classification" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Data Classification</label>
        <select id="aci-classification" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('dataClassification')}>
          {ACCESS_ITEM_CLASSIFICATIONS.map((classification) => <option key={classification} value={classification}>{classification}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2 pt-6 text-sm">
        <input id="aci-privileged" type="checkbox" {...register('privilegedAccess')} />
        <label htmlFor="aci-privileged" className="font-semibold text-amber-700 dark:text-amber-300">Privileged Access</label>
      </div>
      <div>
        <label htmlFor="aci-owner" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">System Owner</label>
        <select id="aci-owner" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('systemOwnerId')}>
          <option value="">— เลือกผู้รับผิดชอบ —</option>
          {people.map((person) => <option key={person.id} value={person.id}>{person.full_name} ({person.email})</option>)}
        </select>
        {errors.systemOwnerId && <p className="mt-1 text-xs text-red-600">{errors.systemOwnerId.message}</p>}
      </div>
      <div>
        <label htmlFor="aci-approver" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Default Approver (ถ้ามี)</label>
        <select id="aci-approver" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('defaultApproverId')}>
          <option value="">— ใช้หัวหน้างานผู้รับสิทธิ์ —</option>
          {people.map((person) => <option key={person.id} value={person.id}>{person.full_name} ({person.email})</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="aci-description" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">คำอธิบาย</label>
        <textarea id="aci-description" rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('description')} />
      </div>
      {serverError && <p className="text-xs text-red-600 sm:col-span-2">{serverError}</p>}
      <div className="sm:col-span-2"><Button type="submit" size="sm" isLoading={isSubmitting}>บันทึก</Button></div>
    </form>
  );
}

function AccessControlItemsSection() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('access_system.manage');
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState<AccessControlItem | null>(null);
  const queryClient = useQueryClient();
  const systemsQuery = useQuery({ queryKey: ['admin', 'access-systems'], queryFn: () => apiFetch<AccessSystem[]>('/api/v1/access-systems') });
  const itemsQuery = useQuery({ queryKey: ['admin', 'access-control-items'], queryFn: () => apiFetch<AccessControlItem[]>('/api/v1/access-control-items') });
  const peopleQuery = useQuery({ queryKey: ['admin', 'access-control-people'], queryFn: () => apiFetch<AccessPersonOption[]>('/api/v1/access-control-items/people'), enabled: canManage });
  const toggleStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' }) => apiFetch(`/api/v1/access-control-items/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'access-control-items'] });
      void queryClient.invalidateQueries({ queryKey: ['access-control-items'] });
    },
  });
  const systems = systemsQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <span>RBAC Catalog — Role / Profile / Group / Entitlement</span>
        <RequirePermission permission="access_system.manage"><Button size="sm" variant="outline" onClick={() => setShowCreate((value) => !value)}><Plus className="h-4 w-4" aria-hidden="true" />เพิ่ม RBAC item</Button></RequirePermission>
      </CardHeader>
      <CardBody>
        {showCreate && <FormModal title="เพิ่ม RBAC item" description="กำหนดสิทธิ์จริงของแต่ละระบบสำหรับให้ผู้ใช้เลือก" size="lg" onClose={() => setShowCreate(false)}><CreateAccessControlItemForm systems={systems} people={peopleQuery.data ?? []} onClose={() => setShowCreate(false)} /></FormModal>}
        {editingItem && <FormModal title="แก้ไข RBAC item" size="lg" onClose={() => setEditingItem(null)}><CreateAccessControlItemForm item={editingItem} systems={systems} people={peopleQuery.data ?? []} onClose={() => setEditingItem(null)} /></FormModal>}
        {itemsQuery.isLoading && <div className="flex justify-center py-8" role="status"><Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" /></div>}
        {items.length === 0 && !itemsQuery.isLoading && <EmptyState icon={<KeyRound className="h-10 w-10" aria-hidden="true" />} title="ยังไม่มี RBAC item" />}
        {items.length > 0 && <div className="overflow-x-auto"><DataTable className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500 dark:text-slate-400"><tr><th className="px-2 py-2">ระบบ / ชนิด</th><th className="px-2 py-2">ชื่อสิทธิ์</th><th className="px-2 py-2">Actions</th><th className="px-2 py-2">Classification</th><th className="px-2 py-2">Owner / Approver</th><th className="px-2 py-2">สถานะ</th><th className="px-2 py-2" /></tr></thead><tbody>{sortNewestFirst(items).map((item) => <tr key={item.id} className="border-t border-slate-100 dark:border-slate-700"><td className="px-2 py-2"><div className="font-medium">{item.access_systems?.name ?? systems.find((system) => system.id === item.system_id)?.name ?? '—'}</div><div className="text-xs uppercase text-slate-500">{item.kind} · {item.code}</div></td><td className="px-2 py-2 font-medium">{item.name}</td><td className="px-2 py-2 text-xs">{item.permission_actions.join(', ')}</td><td className="px-2 py-2 text-xs">{item.data_classification}{item.privileged_access && <div className="font-semibold text-red-600">Privileged</div>}</td><td className="px-2 py-2 text-xs text-slate-500"><div>{item.system_owner?.full_name ?? '—'}</div><div>→ {item.default_approver?.full_name ?? 'หัวหน้างาน'}</div></td><td className="px-2 py-2"><StatusBadge status={item.status} /></td><td className="px-2 py-2 text-right"><RowActions recordLabel={item.name} actions={[{ kind: 'edit', permission: 'access_system.manage', onClick: () => setEditingItem(item) }, { kind: 'custom', icon: item.status === 'active' ? Ban : CheckCircle2, label: item.status === 'active' ? 'ระงับ' : 'เปิดใช้งาน', permission: 'access_system.manage', onClick: () => toggleStatus.mutate({ id: item.id, status: item.status === 'active' ? 'inactive' : 'active' }) }]} /></td></tr>)}</tbody></DataTable></div>}
      </CardBody>
    </Card>
  );
}

const MASTER_KIND_OPTIONS: Array<{ value: MasterDataKind; label: string }> = [
  { value: 'department', label: 'หน่วยงาน' },
  { value: 'position', label: 'ตำแหน่ง' },
  { value: 'ticket_category', label: 'หมวด Ticket' },
  { value: 'asset_category', label: 'หมวด Asset' },
  { value: 'access_system', label: 'ระบบงาน' },
  { value: 'cause_code', label: 'รหัสสาเหตุ' },
];

function MasterDataImportModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<MasterDataKind>('ticket_category');
  const [rows, setRows] = useState<ParsedMasterDataCsvRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState('');

  const parse = (text: string) => {
    setRaw(text);
    try {
      setRows(parseMasterDataCsv(text));
      setError(null);
    } catch (reason) {
      setRows([]);
      setError(reason instanceof Error ? reason.message : 'CSV ไม่ถูกต้อง');
    }
  };

  const mutation = useMutation({
    mutationFn: () => apiFetch<{ importedCount: number }>('/api/v1/master-data/import', {
      method: 'POST',
      body: JSON.stringify({ kind, rows }),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'master-data-registry'] });
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : 'นำเข้า Master Data ไม่สำเร็จ'),
  });

  return (
    <Modal title="Import Master Data จาก CSV" description="ต้องมีคอลัมน์ Code, Name และรองรับ Status, Effective Date, Sort Order · สูงสุด 1,000 แถว" icon={<FileUp className="h-5 w-5" />} size="lg" onClose={onClose}>
      <div className="space-y-4 p-5">
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ชนิดข้อมูลที่จะนำเข้า
          <select value={kind} onChange={(event) => setKind(event.target.value as MasterDataKind)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900">
            {MASTER_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-primary-300 bg-primary-50 px-4 py-4 text-sm font-semibold text-primary-800 dark:border-primary-800 dark:bg-primary-950/30 dark:text-primary-200">
          <Upload className="h-5 w-5" />
          {fileName || 'เลือกไฟล์ CSV'}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setFileName(file.name);
            void file.text().then(parse);
          }} />
        </label>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
          หรือวาง CSV
          <textarea rows={9} value={raw} onChange={(event) => parse(event.target.value)} placeholder={'Code,Name,Status,Effective Date,Sort Order\nNET-001,Network,active,2026-09-13,10'} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900" />
        </label>
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900"><span><strong>{rows.length}</strong> แถวพร้อมนำเข้า · Code เดิมจะถูกอัปเดต ไม่สร้างรายการซ้ำ</span><FileUp className="h-4 w-4 text-slate-400" /></div>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>ยกเลิก</Button><Button isLoading={mutation.isPending} disabled={rows.length === 0} onClick={() => mutation.mutate()}><Upload className="h-4 w-4" />นำเข้า {rows.length} แถว</Button></div>
      </div>
    </Modal>
  );
}

function MasterDataMergeModal({ source, candidates, onClose }: { source: MasterDataRegistryItem; candidates: MasterDataRegistryItem[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [targetId, setTargetId] = useState(candidates.find((item) => item.status === 'active')?.id ?? candidates[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const target = candidates.find((item) => item.id === targetId);
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/master-data/${source.kind}/${source.id}/merge`, { method: 'POST', body: JSON.stringify({ targetId, reason }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'master-data-registry'] });
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (reasonValue) => setError(reasonValue instanceof ApiError ? reasonValue.message : 'รวมรายการไม่สำเร็จ'),
  });

  return (
    <Modal title="Merge Duplicate" description="ย้ายข้อมูลที่อ้างอิงจากรายการซ้ำไปยังรายการหลัก แล้วคงรายการซ้ำเป็น Inactive" icon={<GitMerge className="h-5 w-5" />} size="md" onClose={onClose}>
      <div className="space-y-4 p-5">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-bold">ต้นทาง: {source.code} · {source.name}</p><p className="mt-1 text-xs">จะไม่ลบข้อมูลต้นทาง แต่เปลี่ยนเป็น Inactive เพื่อเก็บประวัติ</p></div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">รวมเข้ากับรายการหลัก<select value={targetId} onChange={(event) => setTargetId(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">— เลือกรายการ —</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}{item.status === 'inactive' ? ' (Inactive)' : ''}</option>)}</select></label>
        {target && <p className="text-xs text-slate-500">Used By ของปลายทาง: {target.used_by_count} รายการ</p>}
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">เหตุผลการรวม <textarea required minLength={3} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="เช่น รวมชื่อหมวดที่สะกดต่างกันให้ใช้รหัสเดียว" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
        {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>ยกเลิก</Button><Button isLoading={mutation.isPending} disabled={!targetId || reason.trim().length < 3} onClick={() => mutation.mutate()}><GitMerge className="h-4 w-4" />ยืนยัน Merge</Button></div>
      </div>
    </Modal>
  );
}

function MasterDataAuditHistoryModal({ item, onClose }: { item: MasterDataRegistryItem; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['admin', 'master-data-audit', item.kind, item.id],
    queryFn: () => apiFetch<MasterDataAuditItem[]>(`/api/v1/master-data/${item.kind}/${item.id}/audit-history`),
  });
  return (
    <Modal title={`Audit History · ${item.code}`} description={`${item.kind_label} · ${item.name}`} icon={<History className="h-5 w-5" />} size="lg" onClose={onClose}>
      <div className="p-5">
        {query.isLoading && <div className="flex justify-center py-8" role="status"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}
        {query.isError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">โหลด Audit History ไม่สำเร็จ</p>}
        {query.data && query.data.length === 0 && <EmptyState icon={<History className="h-8 w-8" />} title="ยังไม่มีประวัติ" />}
        {query.data && query.data.length > 0 && <div className="overflow-x-auto"><DataTable className="w-full text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="px-2 py-2">วันเวลา</th><th className="px-2 py-2">การกระทำ</th><th className="px-2 py-2">ผู้ดำเนินการ</th><th className="px-2 py-2">รายละเอียด</th></tr></thead><tbody>{query.data.map((entry) => <tr key={entry.id} className="border-t border-slate-100 dark:border-slate-700"><td className="whitespace-nowrap px-2 py-2 text-xs text-slate-500">{new Date(entry.created_at).toLocaleString('th-TH')}</td><td className="px-2 py-2 font-semibold">{entry.action}</td><td className="px-2 py-2 text-xs">{entry.actor_email ?? 'ระบบ'}</td><td className="max-w-[320px] px-2 py-2 text-xs text-slate-500">{entry.detail ? JSON.stringify(entry.detail) : '—'}</td></tr>)}</tbody></DataTable></div>}
      </div>
    </Modal>
  );
}

function MasterDataRegistrySection() {
  const { hasPermission } = useAuth();
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<MasterDataKind | ''>('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | ''>('');
  const [showImport, setShowImport] = useState(false);
  const [mergeSource, setMergeSource] = useState<MasterDataRegistryItem | null>(null);
  const [auditItem, setAuditItem] = useState<MasterDataRegistryItem | null>(null);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['admin', 'master-data-registry'], queryFn: () => apiFetch<MasterDataRegistryItem[]>('/api/v1/master-data') });
  const statusMutation = useMutation({
    mutationFn: (item: MasterDataRegistryItem) => apiFetch(`${item.source_path}/${item.id}`, { method: 'PATCH', body: JSON.stringify(item.kind === 'cause_code' ? { isActive: item.status !== 'active' } : { status: item.status === 'active' ? 'inactive' : 'active' }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'master-data-registry'] }),
  });
  const filtered = useMemo(() => (query.data ?? []).filter((item) => (!kindFilter || item.kind === kindFilter) && (!statusFilter || item.status === statusFilter) && (!search.trim() || `${item.code} ${item.name} ${item.kind_label}`.toLowerCase().includes(search.trim().toLowerCase()))), [kindFilter, query.data, search, statusFilter]);
  const manageAny = ['department.manage', 'position.manage', 'ticket_category.manage', 'asset_category.manage', 'access_system.manage', 'cause_code.manage'].some((permission) => hasPermission(permission));
  const sourceCandidates = mergeSource ? (query.data ?? []).filter((item) => item.kind === mergeSource.kind && item.id !== mergeSource.id && item.status === 'active') : [];

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3"><div><span className="flex items-center gap-2"><Database className="h-4 w-4 text-primary-600" />ทะเบียนกลางทั้งหมด</span><p className="mt-1 text-xs font-normal text-slate-500">Code เดียว ใช้ร่วมกันทุกโมดูล · รายการที่ถูกอ้างอิงจะใช้ Inactive แทนการลบ</p></div><div className="flex flex-wrap gap-2">{manageAny && <Button size="sm" variant="outline" onClick={() => setShowImport(true)}><Upload className="h-4 w-4" />Import CSV</Button>}<ExportCsvButton disabled={filtered.length === 0} fileName="master-data-registry.csv" label="Export" getRows={() => [['Type', 'Code', 'Name', 'Status', 'Effective Date', 'Sort Order', 'Used By'], ...filtered.map((item) => [item.kind_label, item.code, item.name, item.status, item.effective_date, item.sort_order, item.used_by.map((usage) => `${usage.label}: ${usage.count}`).join(' · ') || '—'])]} /></div></CardHeader>
      <CardBody>
        {showImport && <MasterDataImportModal onClose={() => setShowImport(false)} />}
        {mergeSource && <MasterDataMergeModal source={mergeSource} candidates={sourceCandidates} onClose={() => setMergeSource(null)} />}
        {auditItem && <MasterDataAuditHistoryModal item={auditItem} onClose={() => setAuditItem(null)} />}
        <div className="mb-4 grid gap-2 md:grid-cols-[minmax(220px,1fr)_190px_150px]"><label className="relative block"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><span className="sr-only">ค้นหา Master Data</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหา Code, Name หรือชนิดข้อมูล" className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm dark:border-slate-600 dark:bg-slate-900" /></label><select aria-label="กรองชนิดข้อมูล" value={kindFilter} onChange={(event) => setKindFilter(event.target.value as MasterDataKind | '')} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">ทุกชนิดข้อมูล</option>{MASTER_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><select aria-label="กรองสถานะ" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">ทุกสถานะ</option><option value="active">ใช้งาน</option><option value="inactive">Inactive</option></select></div>
        {query.isLoading && <div className="flex justify-center py-10" role="status"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}
        {query.isError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">โหลดทะเบียนกลางไม่สำเร็จ กรุณาลองใหม่</p>}
        {!query.isLoading && !query.isError && filtered.length === 0 && <EmptyState icon={<Database className="h-10 w-10" />} title="ไม่พบรายการ Master Data" message="ลองเปลี่ยนตัวกรองหรือเพิ่มรายการใหม่จากส่วนจัดการด้านล่าง" />}
        {filtered.length > 0 && <div className="overflow-x-auto"><DataTable className="w-full min-w-[980px] text-left text-sm"><thead className="text-xs uppercase text-slate-500 dark:text-slate-400"><tr><th className="px-2 py-2">Type</th><th className="px-2 py-2">Code</th><th className="px-2 py-2">Name</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Effective Date</th><th className="px-2 py-2">Sort</th><th className="px-2 py-2">Used By</th><th className="px-2 py-2" /></tr></thead><tbody>{filtered.map((item) => <tr key={`${item.kind}-${item.id}`} className="border-t border-slate-100 dark:border-slate-700"><td className="px-2 py-2 text-xs text-slate-500">{item.kind_label}</td><td className="px-2 py-2 font-mono text-xs font-semibold text-primary-700 dark:text-primary-300">{item.code}</td><td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">{item.name}</td><td className="px-2 py-2"><StatusBadge status={item.status} /></td><td className="px-2 py-2 text-xs text-slate-500">{item.effective_date || '—'}</td><td className="px-2 py-2 text-xs text-slate-500">{item.sort_order}</td><td className="px-2 py-2 text-xs">{item.used_by_count > 0 ? <div className="flex flex-wrap gap-1">{item.used_by.map((usage) => <span key={usage.key} className="rounded-full bg-primary-50 px-2 py-0.5 text-primary-700 dark:bg-primary-950/40 dark:text-primary-200">{usage.label} {usage.count}</span>)}</div> : <span className="text-slate-400">ยังไม่ถูกใช้งาน</span>}</td><td className="px-2 py-2 text-right"><div className="flex flex-wrap justify-end gap-1">{hasPermission(item.permission) && <button type="button" title={item.status === 'active' ? 'เปลี่ยนเป็น Inactive' : 'เปิดใช้งาน'} aria-label={`${item.status === 'active' ? 'เปลี่ยนเป็น Inactive' : 'เปิดใช้งาน'} ${item.name}`} onClick={() => statusMutation.mutate(item)} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-primary-700 hover:bg-primary-50 dark:text-primary-300"><CheckCircle2 className="h-3.5 w-3.5" />{item.status === 'active' ? 'Inactive' : 'เปิดใช้'}</button>}{hasPermission(item.permission) && (query.data ?? []).some((candidate) => candidate.kind === item.kind && candidate.id !== item.id) && <button type="button" title="Merge Duplicate" aria-label={`Merge Duplicate ${item.name}`} onClick={() => setMergeSource(item)} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-amber-700 hover:bg-amber-50 dark:text-amber-300"><GitMerge className="h-3.5 w-3.5" />Merge</button>}{hasPermission('audit.view') && <button type="button" title="Audit History" aria-label={`Audit History ${item.name}`} onClick={() => setAuditItem(item)} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300"><History className="h-3.5 w-3.5" />Audit</button>}</div>{item.used_by_count > 0 && <span className="mt-1 block whitespace-nowrap text-right text-[10px] font-semibold text-amber-700 dark:text-amber-300"><LockKeyhole className="mr-0.5 inline h-3 w-3" />ถูกใช้งาน · ห้ามลบ</span>}</td></tr>)}</tbody></DataTable></div>}
      </CardBody>
    </Card>
  );
}

export function MasterDataPage() {
  const { hasPermission } = useAuth();
  const canManageAccess = hasPermission('access_system.manage');
  const ticketCategoriesQuery = useQuery({ queryKey: ['admin', 'ticket-categories'], queryFn: () => apiFetch<TicketCategory[]>('/api/v1/ticket-categories') });
  const assetCategoriesQuery = useQuery({ queryKey: ['admin', 'asset-categories'], queryFn: () => apiFetch<AssetCategory[]>('/api/v1/asset-categories') });
  const accessSystemsQuery = useQuery({ queryKey: ['admin', 'access-systems'], queryFn: () => apiFetch<AccessSystem[]>('/api/v1/access-systems') });
  const accessItemsQuery = useQuery({ queryKey: ['admin', 'access-control-items'], queryFn: () => apiFetch<AccessControlItem[]>('/api/v1/access-control-items'), enabled: canManageAccess });
  const totalMasterData = (ticketCategoriesQuery.data?.length ?? 0) + (assetCategoriesQuery.data?.length ?? 0) + (accessSystemsQuery.data?.length ?? 0) + (accessItemsQuery.data?.length ?? 0);
  const activeMasterData = [...(ticketCategoriesQuery.data ?? []), ...(assetCategoriesQuery.data ?? []), ...(accessSystemsQuery.data ?? []), ...(accessItemsQuery.data ?? [])].filter((item) => item.status === 'active').length;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle eyebrow="ตั้งค่าและบัญชี / Master Data" title="Master Data" description="แหล่งข้อมูลกลางของ Code, Name, Status และ lifecycle ที่ทุกโมดูลอ้างอิงร่วมกัน" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={<Database className="h-5 w-5" />} label="Master Data ทั้งหมด" value={totalMasterData} tone="primary" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="รายการที่ใช้งาน" value={activeMasterData} tone="teal" />
        <StatCard icon={<FolderTree className="h-5 w-5" />} label="หมวด Ticket / Asset" value={(ticketCategoriesQuery.data?.length ?? 0) + (assetCategoriesQuery.data?.length ?? 0)} tone="amber" />
        <StatCard icon={<KeyRound className="h-5 w-5" />} label="ระบบที่ขอสิทธิ์ได้" value={accessSystemsQuery.data?.length ?? 0} tone="gray" />
      </div>
      <MasterDataRegistrySection />
      <TicketCategoriesSection />
      <AssetCategoriesSection />
      <AccessSystemsSection />
      <RequirePermission permission="access_system.manage"><AccessControlItemsSection /></RequirePermission>
      <CauseCodesSection />
    </div>
  );
}
