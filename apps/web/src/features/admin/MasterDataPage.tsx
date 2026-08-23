import { DataTable } from '../../components/table/DataTable';
import { FormModal } from '../../components/ui/Modal';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Database, FolderTree, KeyRound, Loader2, Plus, Tags, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { RowActions } from '../../components/table/RowActions';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { AssetCategory, TicketCategory } from '../../types/admin';
import type { AccessSystem } from '../../types/accessRequests';

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
  name: z.string().trim().min(1, 'กรุณากรอกชื่อหมวดหมู่'),
  defaultPriority: z.enum(TICKET_PRIORITIES).optional(),
  responseSlaHours: z.coerce.number().positive().optional().or(z.literal('').transform(() => undefined)),
  resolutionSlaHours: z.coerce.number().positive().optional().or(z.literal('').transform(() => undefined)),
});

type TicketCategoryForm = z.infer<typeof ticketCategorySchema>;

function CreateTicketCategoryForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TicketCategoryForm>({ resolver: zodResolver(ticketCategorySchema) });

  const mutation = useMutation({
    mutationFn: (values: TicketCategoryForm) =>
      apiFetch('/api/v1/ticket-categories', { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'ticket-categories'] });
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
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">เพิ่มหมวดหมู่ Ticket</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
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
        <label htmlFor="tc-priority" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ความสำคัญเริ่มต้น
        </label>
        <select
          id="tc-priority"
          defaultValue="ปานกลาง"
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
                  <th className="px-2 py-2">ชื่อหมวดหมู่</th>
                  <th className="px-2 py-2">ความสำคัญเริ่มต้น</th>
                  <th className="px-2 py-2">Response SLA</th>
                  <th className="px-2 py-2">Resolution SLA</th>
                  <th className="px-2 py-2">สถานะ</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {query.data.map((cat) => (
                  <tr key={cat.id} className="border-t border-slate-100 dark:border-slate-700">
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
                    <td className="px-2 py-2 text-right">
                      <RequirePermission permission="ticket_category.manage">
                        <button
                          type="button"
                          onClick={() =>
                            toggleStatus.mutate({ id: cat.id, status: cat.status === 'active' ? 'inactive' : 'active' })
                          }
                          className="text-xs text-primary-700 hover:underline dark:text-primary-300"
                        >
                          {cat.status === 'active' ? 'ระงับ' : 'เปิดใช้งาน'}
                        </button>
                      </RequirePermission>
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
  name: z.string().trim().min(1, 'กรุณากรอกชื่อหมวดหมู่'),
  codePrefix: z
    .string()
    .trim()
    .min(1, 'กรุณากรอกคำนำหน้ารหัส')
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, 'ใช้ตัวอักษร A-Z, ตัวเลข, - เท่านั้น'),
});

type AssetCategoryForm = z.infer<typeof assetCategorySchema>;

function CreateAssetCategoryForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AssetCategoryForm>({ resolver: zodResolver(assetCategorySchema) });

  const mutation = useMutation({
    mutationFn: (values: AssetCategoryForm) =>
      apiFetch('/api/v1/asset-categories', { method: 'POST', body: JSON.stringify(values) }),
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
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">เพิ่มหมวดหมู่ทรัพย์สิน</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
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
                  <th className="px-2 py-2">ชื่อหมวดหมู่</th>
                  <th className="px-2 py-2">คำนำหน้ารหัส</th>
                  <th className="px-2 py-2">สถานะ</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {query.data.map((cat) => (
                  <tr key={cat.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">{cat.name}</td>
                    <td className="px-2 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{cat.code_prefix}</td>
                    <td className="px-2 py-2">
                      <StatusBadge status={cat.status} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <RowActions
                        recordLabel={cat.name}
                        actions={[{
                          kind: 'custom',
                          icon: cat.status === 'active' ? Ban : CheckCircle2,
                          label: cat.status === 'active' ? 'ระงับ' : 'เปิดใช้งาน',
                          permission: 'asset_category.manage',
                          onClick: () => toggleStatus.mutate({ id: cat.id, status: cat.status === 'active' ? 'inactive' : 'active' }),
                        }]}
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
  name: z.string().trim().min(1, 'กรุณากรอกชื่อระบบงาน'),
});

type AccessSystemForm = z.infer<typeof accessSystemSchema>;

function CreateAccessSystemForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AccessSystemForm>({ resolver: zodResolver(accessSystemSchema) });

  const mutation = useMutation({
    mutationFn: (values: AccessSystemForm) => apiFetch('/api/v1/access-systems', { method: 'POST', body: JSON.stringify(values) }),
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
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">เพิ่มระบบงาน</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
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
                  <th className="px-2 py-2">ชื่อระบบงาน</th>
                  <th className="px-2 py-2">สถานะ</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {query.data.map((system) => (
                  <tr key={system.id} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">{system.name}</td>
                    <td className="px-2 py-2">
                      <StatusBadge status={system.status} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <RequirePermission permission="access_system.manage">
                        <button
                          type="button"
                          onClick={() =>
                            toggleStatus.mutate({ id: system.id, status: system.status === 'active' ? 'inactive' : 'active' })
                          }
                          className="text-xs text-primary-700 hover:underline dark:text-primary-300"
                        >
                          {system.status === 'active' ? 'ระงับ' : 'เปิดใช้งาน'}
                        </button>
                      </RequirePermission>
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

export function MasterDataPage() {
  const ticketCategoriesQuery = useQuery({ queryKey: ['admin', 'ticket-categories'], queryFn: () => apiFetch<TicketCategory[]>('/api/v1/ticket-categories') });
  const assetCategoriesQuery = useQuery({ queryKey: ['admin', 'asset-categories'], queryFn: () => apiFetch<AssetCategory[]>('/api/v1/asset-categories') });
  const accessSystemsQuery = useQuery({ queryKey: ['admin', 'access-systems'], queryFn: () => apiFetch<AccessSystem[]>('/api/v1/access-systems') });
  const totalMasterData = (ticketCategoriesQuery.data?.length ?? 0) + (assetCategoriesQuery.data?.length ?? 0) + (accessSystemsQuery.data?.length ?? 0);
  const activeMasterData = [...(ticketCategoriesQuery.data ?? []), ...(assetCategoriesQuery.data ?? []), ...(accessSystemsQuery.data ?? [])].filter((item) => item.status === 'active').length;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle eyebrow="ตั้งค่าและบัญชี / Master Data" title="Master Data" description="หมวดหมู่กลางที่โมดูล Ticket, Asset และคำขอสิทธิ์ระบบ จะอ้างอิงต่อ" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={<Database className="h-5 w-5" />} label="Master Data ทั้งหมด" value={totalMasterData} tone="primary" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="รายการที่ใช้งาน" value={activeMasterData} tone="teal" />
        <StatCard icon={<FolderTree className="h-5 w-5" />} label="หมวด Ticket / Asset" value={(ticketCategoriesQuery.data?.length ?? 0) + (assetCategoriesQuery.data?.length ?? 0)} tone="amber" />
        <StatCard icon={<KeyRound className="h-5 w-5" />} label="ระบบที่ขอสิทธิ์ได้" value={accessSystemsQuery.data?.length ?? 0} tone="gray" />
      </div>
      <TicketCategoriesSection />
      <AssetCategoriesSection />
      <AccessSystemsSection />
    </div>
  );
}
