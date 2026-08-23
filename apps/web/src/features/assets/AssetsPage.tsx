import { DataTable, TablePagination } from '../../components/table/DataTable';
import { useTableParams } from '../../hooks/useTableParams';
import { ExportAllButton } from '../../components/table/ExportAllButton';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Boxes, CalendarClock, ClipboardCheck, Loader2, Plus, Repeat2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { BulkActionModal, BulkResultSummary, bulkFieldClass, bulkTextareaClass, type BulkResult } from '../../components/table/BulkAction';
import { RowActions } from '../../components/table/RowActions';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { QueryError } from '../../components/ui/QueryError';
import { Modal } from '../../components/ui/Modal';
import { PageTitle } from '../../components/ui/PageTitle';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { AssetCategory, EmployeeOption, PaginatedResult } from '../../types/admin';
import type { Asset } from '../../types/assets';
import type { ContractOption, ContractVendorRef } from '../../types/vendorsContracts';
import { ASSET_STATUSES, ASSET_TYPES, assetStatusTone } from './assetDisplay';

const createAssetSchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อทรัพย์สิน'),
  categoryId: z.string().optional(),
  assetType: z.enum(ASSET_TYPES).optional(),
  brand: z.string().trim().optional(),
  model: z.string().trim().optional(),
  serialNumber: z.string().trim().optional(),
  vendorId: z.string().optional(),
  contractId: z.string().optional(),
  location: z.string().trim().optional(),
  price: z.coerce.number().nonnegative().optional().or(z.literal('')),
});
type CreateAssetForm = z.infer<typeof createAssetSchema>;

/** สถานะที่เปลี่ยนทีละหลายชิ้นได้ — ต้องตรงกับ BULK_ASSET_STATUSES ฝั่ง api */
const BULK_ASSET_STATUSES = ['พร้อมใช้งาน', 'ใช้งานอยู่', 'ซ่อมบำรุง'] as const;

type AssetBulkResult = BulkResult<{ id: string; assetCode: string; status: string }>;

/**
 * แผงดำเนินการกับทรัพย์สินที่เลือกไว้หลายชิ้น
 * เลือกได้ทีละอย่างเช่นเดียวกับหน้า Ticket เพื่อให้ประวัติการเคลื่อนไหว (asset_movements)
 * อ่านแล้วรู้ว่าเกิดอะไรขึ้น
 */
function BulkAssetPanel({
  ids,
  employees,
  canUpdate,
  canTransfer,
  onClose,
  onDone,
}: {
  ids: string[];
  employees: EmployeeOption[];
  canUpdate: boolean;
  canTransfer: boolean;
  onClose: () => void;
  onDone: (result: AssetBulkResult) => void;
}) {
  const actions = [
    ...(canUpdate ? ([['status', 'เปลี่ยนสถานะ'], ['location', 'ย้ายสถานที่']] as const) : []),
    ...(canTransfer ? ([['owner', 'มอบหมาย/รับคืน']] as const) : []),
  ];
  const [action, setAction] = useState<'status' | 'location' | 'owner'>(actions[0]![0]);
  const [status, setStatus] = useState<string>(BULK_ASSET_STATUSES[0]);
  const [location, setLocation] = useState('');
  const [ownerEmployeeId, setOwnerEmployeeId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiFetch<AssetBulkResult>('/api/v1/assets/bulk', {
      method: 'PATCH',
      body: JSON.stringify({
        ids,
        notes: notes.trim() || undefined,
        ...(action === 'status' ? { status } : {}),
        ...(action === 'location' ? { location: location.trim() } : {}),
        // ช่องว่าง = รับคืนเข้าคลัง ซึ่ง api แยกออกจาก "ไม่ได้สั่งเปลี่ยนผู้ถือครอง" ด้วย null
        ...(action === 'owner' ? { ownerEmployeeId: ownerEmployeeId || null } : {}),
      }),
    }),
    onSuccess: onDone,
    onError: (mutationError) => setError(mutationError instanceof ApiError ? mutationError.message : 'ดำเนินการไม่สำเร็จ'),
  });

  return (
    <BulkActionModal
      count={ids.length}
      itemLabel="รายการ"
      isPending={mutation.isPending}
      error={error}
      onClose={onClose}
      onSubmit={() => {
        if (action === 'location' && !location.trim()) {
          setError('กรุณากรอกสถานที่ปลายทาง');
          return;
        }
        setError(null);
        mutation.mutate();
      }}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {actions.map(([value, label]) => (
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

        {action === 'status' && (
          <label className="block text-sm">
            <span className="font-semibold text-slate-700 dark:text-slate-200">สถานะใหม่</span>
            <select aria-label="สถานะใหม่" value={status} onChange={(event) => setStatus(event.target.value)} className={bulkFieldClass}>
              {BULK_ASSET_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              การจำหน่าย/เลิกใช้ และการแจ้งสูญหาย ต้องทำทีละชิ้น เพราะเป็นการนำของออกจากทะเบียนใช้งานและต้องบันทึกเหตุผลของชิ้นนั้น
            </p>
          </label>
        )}

        {action === 'location' && (
          <label className="block text-sm">
            <span className="font-semibold text-slate-700 dark:text-slate-200">สถานที่ปลายทาง</span>
            <input
              aria-label="สถานที่ปลายทาง"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              maxLength={120}
              className={bulkFieldClass}
            />
          </label>
        )}

        {action === 'owner' && (
          <label className="block text-sm">
            <span className="font-semibold text-slate-700 dark:text-slate-200">ผู้ถือครอง</span>
            <select aria-label="ผู้ถือครอง" value={ownerEmployeeId} onChange={(event) => setOwnerEmployeeId(event.target.value)} className={bulkFieldClass}>
              <option value="">รับคืนเข้าคลัง (ล้างผู้ถือครอง)</option>
              {employees.map((person) => (
                <option key={person.id} value={person.id}>{`${person.first_name_th} ${person.last_name_th}`}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              ชิ้นที่ถูกจำหน่าย/สูญหายไปแล้วจะถูกข้ามและรายงานกลับพร้อมรหัสทรัพย์สิน
            </p>
          </label>
        )}

        <label className="block text-sm">
          <span className="font-semibold text-slate-700 dark:text-slate-200">หมายเหตุ (ไม่บังคับ)</span>
          <textarea
            aria-label="หมายเหตุ"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={500}
            rows={3}
            className={bulkTextareaClass}
          />
        </label>
      </div>
    </BulkActionModal>
  );
}

function CreateAssetForm({ categories, vendors, contracts, onClose }: { categories: AssetCategory[]; vendors: ContractVendorRef[]; contracts: ContractOption[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateAssetForm>({ resolver: zodResolver(createAssetSchema) });

  const mutation = useMutation({
    mutationFn: (values: CreateAssetForm) =>
      apiFetch('/api/v1/assets', {
        method: 'POST',
        body: JSON.stringify({ ...values, categoryId: values.categoryId || undefined, vendorId: values.vendorId || undefined, contractId: values.contractId || undefined, price: values.price === '' ? undefined : values.price }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เพิ่มทรัพย์สินไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="grid grid-cols-1 gap-x-4 gap-y-4 p-5 sm:grid-cols-3"
      noValidate
    >
      <div className="sm:col-span-2">
        <label htmlFor="as-name" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ชื่อทรัพย์สิน
        </label>
        <input
          id="as-name"
          data-testid="asset-create-name"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('name')}
        />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>

      <div>
        <label htmlFor="as-category" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          หมวดหมู่
        </label>
        <select
          id="as-category"
          data-testid="asset-create-category"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          {...register('categoryId')}
        >
          <option value="">— ไม่ระบุ —</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="as-brand" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ยี่ห้อ
        </label>
        <input id="as-brand" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('brand')} />
      </div>

      <div>
        <label htmlFor="as-vendor" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้จำหน่าย</label>
        <select id="as-vendor" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('vendorId')}><option value="">— ไม่ระบุ —</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_code} — {vendor.name}</option>)}</select>
      </div>

      <div>
        <label htmlFor="as-contract" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สัญญาที่ครอบคลุม</label>
        <select id="as-contract" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('contractId')}><option value="">— ไม่ระบุ —</option>{contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_number} — {contract.name}</option>)}</select>
      </div>

      <div>
        <label htmlFor="as-model" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          รุ่น
        </label>
        <input id="as-model" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('model')} />
      </div>

      <div>
        <label htmlFor="as-serial" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          S/N
        </label>
        <input id="as-serial" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('serialNumber')} />
      </div>

      <div>
        <label htmlFor="as-location" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          สถานที่
        </label>
        <input id="as-location" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('location')} />
      </div>

      <div>
        <label htmlFor="as-price" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          ราคา (บาท)
        </label>
        <input id="as-price" type="number" step="0.01" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('price')} />
      </div>

      {serverError && <p className="text-xs text-red-600 sm:col-span-3">{serverError}</p>}

      <div className="-mx-5 -mb-5 mt-2 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:col-span-3 dark:border-slate-700 dark:bg-slate-900/40">
        <Button type="button" size="sm" variant="outline" disabled={mutation.isPending} onClick={onClose}>
          ยกเลิก
        </Button>
        <Button type="submit" size="sm" isLoading={isSubmitting || mutation.isPending} data-testid="asset-create-submit">
          บันทึก
        </Button>
      </div>
    </form>
  );
}

export function AssetsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canUpdateAsset = hasPermission('asset.update');
  const canTransferAsset = hasPermission('asset.transfer');
  // รายการที่เลือกอยู่นอก URL เพราะเป็นสิ่งที่ทำแล้วจบ ไม่ใช่สถานะที่ควรแชร์ผ่านลิงก์
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkResult, setBulkResult] = useState<AssetBulkResult | null>(null);
  const table = useTableParams<'status' | 'categoryId' | 'search'>({ filters: ['status', 'categoryId', 'search'] });
  const { page, pageSize, sort } = table;
  const { status, categoryId, search } = table.filters;
  const debouncedSearch = useDebouncedValue(search);

  const categoriesQuery = useQuery({
    queryKey: ['admin', 'asset-categories'],
    queryFn: () => apiFetch<AssetCategory[]>('/api/v1/asset-categories'),
  });
  const employeeOptionsQuery = useQuery({
    queryKey: ['employee-options'],
    queryFn: () => apiFetch<EmployeeOption[]>('/api/v1/employees/options'),
    enabled: showBulk && canTransferAsset,
  });
  const vendorOptionsQuery = useQuery({ queryKey: ['vendors-contracts', 'vendor-options'], queryFn: () => apiFetch<ContractVendorRef[]>('/api/v1/vendors/options') });
  const contractOptionsQuery = useQuery({ queryKey: ['vendors-contracts', 'contract-options'], queryFn: () => apiFetch<ContractOption[]>('/api/v1/contracts/options') });

  // query string ตัวเดียวกันทั้งรายการบนหน้าจอและไฟล์ที่ส่งออก (ฝั่ง api มองข้าม page/pageSize
  // ตอนส่งออก) — ถ้าประกอบแยกกัน ไฟล์จะมีของไม่ตรงกับที่ผู้ใช้เห็นโดยไม่มีใครสังเกต
  const assetListParams = `page=${page}&pageSize=${pageSize}${sort ? `&sort=${sort.key}&order=${sort.order}` : ''}${status ? `&status=${encodeURIComponent(status)}` : ''}${categoryId ? `&categoryId=${categoryId}` : ''}${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`;

  const assetsQuery = useQuery({
    queryKey: ['assets', assetListParams],
    queryFn: () => apiFetch<PaginatedResult<Asset>>(`/api/v1/assets?${assetListParams}`),
  });

  const categoryById = new Map((categoriesQuery.data ?? []).map((c) => [c.id, c.name]));
  const items = assetsQuery.data?.items ?? [];
  const kpi = {
    total: assetsQuery.data?.pagination.totalItems ?? 0,
    available: items.filter((a) => a.status === 'พร้อมใช้งาน').length,
    inUse: items.filter((a) => a.status === 'ใช้งานอยู่').length,
    maintenance: items.filter((a) => a.status === 'ซ่อมบำรุง').length,
    retired: items.filter((a) => a.status === 'จำหน่าย/เลิกใช้').length,
  };
  const warrantyExpiring = items.filter((a) => a.warrantyDaysLeft !== null && a.warrantyDaysLeft >= 0 && a.warrantyDaysLeft <= 60);
  const warrantyExpired = items.filter((a) => a.warrantyDaysLeft !== null && a.warrantyDaysLeft < 0);
  const activeLoans = items.filter((a) => Boolean(a.loan_date));
  const overdueLoans = activeLoans.filter((a) => a.loan_due_date && Date.parse(`${a.loan_due_date}T23:59:59`) < Date.now());
  const lifecycleTotal = Math.max(1, kpi.available + kpi.inUse + kpi.maintenance + kpi.retired);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <PageTitle eyebrow="ทรัพย์สินและโครงสร้างพื้นฐาน / ทะเบียนทรัพย์สิน" title="ทะเบียนทรัพย์สิน IT" description="Asset Register — ยืม/คืน/โอนย้าย/ส่งซ่อม/ตรวจนับ" />
        <RequirePermission permission="asset.create">
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="asset-create-toggle" aria-haspopup="dialog">
            <Plus className="h-4 w-4" aria-hidden="true" />
            เพิ่มทรัพย์สิน
          </Button>
        </RequirePermission>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard icon={<Boxes className="h-5 w-5" aria-hidden="true" />} label="ทั้งหมด" value={kpi.total} tone="primary" />
        <StatCard icon={<Boxes className="h-5 w-5" aria-hidden="true" />} label="พร้อมใช้งาน (หน้านี้)" value={kpi.available} tone="teal" />
        <StatCard icon={<Boxes className="h-5 w-5" aria-hidden="true" />} label="ใช้งานอยู่ (หน้านี้)" value={kpi.inUse} tone="gray" />
        <StatCard icon={<Boxes className="h-5 w-5" aria-hidden="true" />} label="ซ่อมบำรุง (หน้านี้)" value={kpi.maintenance} tone="amber" />
        <StatCard icon={<Boxes className="h-5 w-5" aria-hidden="true" />} label="ตัดจำหน่าย (หน้านี้)" value={kpi.retired} tone="gray" />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="min-w-0">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <span>รายการทรัพย์สิน</span>
          <div className="flex flex-wrap items-center gap-2 text-xs font-normal">
            <select
              value={categoryId}
              onChange={(e) => {
                table.setFilter('categoryId', e.target.value);
              }}
              className="rounded-full border border-slate-300 px-3 py-1 dark:border-slate-600 dark:bg-slate-900"
            >
              <option value="">ทุกหมวดหมู่</option>
              {(categoriesQuery.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => {
                table.setFilter('status', e.target.value);
              }}
              className="rounded-full border border-slate-300 px-3 py-1 dark:border-slate-600 dark:bg-slate-900"
            >
              <option value="">ทุกสถานะ</option>
              {ASSET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              placeholder="ค้นหาชื่อ รหัสทรัพย์สิน หรือ S/N..."
              value={search}
              onChange={(e) => {
                table.setFilter('search', e.target.value, { replace: true });
              }}
              className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
            <ExportAllButton disabled={!items.length} url={`/api/v1/assets/export?${assetListParams}`} />
          </div>

          {assetsQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}

          {assetsQuery.isError && (
            <QueryError title="โหลดรายการทรัพย์สินไม่สำเร็จ" error={assetsQuery.error} onRetry={() => void assetsQuery.refetch()} isRetrying={assetsQuery.isFetching} />
          )}

          {!assetsQuery.isError && assetsQuery.data && items.length === 0 && <EmptyState icon={<Boxes className="h-10 w-10" aria-hidden="true" />} title="ไม่พบทรัพย์สิน" />}

          {assetsQuery.data && items.length > 0 && (
            <div className="overflow-x-auto">
              <DataTable
                mode="server"
                sort={sort}
                onSortChange={table.setSort}
                freezeFirstColumn
                cardOnMobile
                itemLabel="รายการ"
                selectable={canUpdateAsset || canTransferAsset}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                selectionActions={<Button type="button" size="sm" onClick={() => setShowBulk(true)}>ดำเนินการกับที่เลือก</Button>}
                className="w-full text-left text-sm"
              >
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2" data-sort-key="asset_code">รหัส</th>
                    <th className="px-2 py-2" data-sort-key="name">ชื่อทรัพย์สิน</th>
                    <th className="px-2 py-2">หมวดหมู่</th>
                    <th className="px-2 py-2">ผู้ถือครอง</th>
                    <th className="px-2 py-2" data-sort-key="location">สถานที่</th>
                    <th className="px-2 py-2">สถานะ</th>
                    <th className="px-2 py-2 text-right">ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id} data-row-id={a.id} data-testid={`asset-row-${a.id}`} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-2 py-2 font-mono text-xs text-slate-500 dark:text-slate-400" data-label="รหัส">{a.asset_code}</td>
                      <td className="px-2 py-2" data-label="ชื่อทรัพย์สิน">
                        <Link to={`/assets/${a.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
                          {a.name}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400" data-label="หมวดหมู่">
                        {a.category?.name ?? (a.category_id ? categoryById.get(a.category_id) : null) ?? '—'}
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400" data-label="ผู้ถือครอง">
                        {a.owner ? `${a.owner.first_name_th} ${a.owner.last_name_th}` : '—'}
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400" data-label="สถานที่">{a.location ?? '—'}</td>
                      <td className="px-2 py-2" data-label="สถานะ">
                        <Badge variant={assetStatusTone[a.status]}>{a.status}</Badge>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <RowActions recordLabel={a.asset_code} actions={[{ kind: 'view', to: `/assets/${a.id}` }]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          )}

          {assetsQuery.data && <TablePagination page={assetsQuery.data.pagination.page} pageSize={pageSize} totalItems={assetsQuery.data.pagination.totalItems} totalPages={assetsQuery.data.pagination.totalPages} onPageChange={table.setPage} onPageSizeChange={table.setPageSize} />}
        </CardBody>
      </Card>

      <aside className="flex min-w-0 flex-col gap-3" aria-label="สรุปวงจรชีวิตทรัพย์สิน">
        <Card>
          <CardHeader className="flex items-center gap-2"><Repeat2 className="h-4 w-4 text-primary-600" /><span>วงจรชีวิตทรัพย์สิน</span></CardHeader>
          <CardBody className="space-y-3">
            {[
              ['ใช้งานอยู่', kpi.inUse, 'bg-primary-600'],
              ['พร้อมใช้งาน', kpi.available, 'bg-teal-600'],
              ['ซ่อมบำรุง', kpi.maintenance, 'bg-amber-500'],
              ['ตัดจำหน่าย', kpi.retired, 'bg-slate-300'],
            ].map(([label, value, color]) => (
              <div key={String(label)}>
                <div className="mb-1 flex items-center justify-between text-xs"><span className="text-slate-600 dark:text-slate-300">{label}</span><span className="font-mono font-semibold">{value}</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(3, (Number(value) / lifecycleTotal) * 100)}%` }} /></div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-amber-600" /><span>ประกันและแผน PM</span></CardHeader>
          <CardBody className="space-y-3 text-sm">
            <div className="flex items-center justify-between"><span className="text-slate-500">ประกันหมดใน 60 วัน</span><span className="font-mono font-bold text-amber-700">{warrantyExpiring.length}</span></div>
            <div className="flex items-center justify-between"><span className="text-slate-500">ประกันหมดแล้ว</span><span className="font-mono font-bold text-red-700">{warrantyExpired.length}</span></div>
            <div className="flex items-center justify-between"><span className="text-slate-500">กำลังซ่อม/รอ PM</span><span className="font-mono font-bold">{kpi.maintenance}</span></div>
            <Link to="/maintenance" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline dark:text-primary-300"><ClipboardCheck className="h-3.5 w-3.5" />เปิดแผนบำรุงรักษา</Link>
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary-600" /><span>ยืม / คืน</span></CardHeader>
          <CardBody className="space-y-3 text-sm">
            <div className="flex items-center justify-between"><span className="text-slate-500">กำลังยืม</span><span className="font-mono font-bold">{activeLoans.length}</span></div>
            <div className="flex items-center justify-between"><span className="text-slate-500">เกินกำหนด</span><span className="font-mono font-bold text-red-700">{overdueLoans.length}</span></div>
            <Link to="/asset-borrow" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline dark:text-primary-300"><Repeat2 className="h-3.5 w-3.5" />จัดการยืมและรับคืน</Link>
          </CardBody>
        </Card>
      </aside>
      </div>

      {bulkResult && <BulkResultSummary result={bulkResult} itemLabel="รายการ" onDismiss={() => setBulkResult(null)} />}

      {showBulk && (
        <BulkAssetPanel
          ids={selectedIds}
          employees={employeeOptionsQuery.data ?? []}
          canUpdate={canUpdateAsset}
          canTransfer={canTransferAsset}
          onClose={() => setShowBulk(false)}
          onDone={(result) => {
            setShowBulk(false);
            setBulkResult(result);
            // เหลือเฉพาะชิ้นที่ทำไม่สำเร็จไว้ให้เลือกต่อ ผู้ใช้จะได้ลองแก้เฉพาะที่เหลือ
            setSelectedIds(result.failed.map((item) => item.id));
            void queryClient.invalidateQueries({ queryKey: ['assets'] });
          }}
        />
      )}

      {showCreate && (
        <Modal title="เพิ่มทรัพย์สิน" size="xl" onClose={() => setShowCreate(false)} testId="asset-create-dialog">
          {categoriesQuery.data && vendorOptionsQuery.data && contractOptionsQuery.data ? (
            <CreateAssetForm
              categories={categoriesQuery.data}
              vendors={vendorOptionsQuery.data}
              contracts={contractOptionsQuery.data}
              onClose={() => setShowCreate(false)}
            />
          ) : (
            <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-slate-500" role="status">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              กำลังเตรียมแบบฟอร์ม...
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
