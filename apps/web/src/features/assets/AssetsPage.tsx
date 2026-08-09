import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Boxes, Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { AssetCategory, PaginatedResult } from '../../types/admin';
import type { Asset } from '../../types/assets';
import { ASSET_STATUSES, ASSET_TYPES, assetStatusTone } from './assetDisplay';

const createAssetSchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อทรัพย์สิน'),
  categoryId: z.string().optional(),
  assetType: z.enum(ASSET_TYPES).optional(),
  brand: z.string().trim().optional(),
  model: z.string().trim().optional(),
  serialNumber: z.string().trim().optional(),
  location: z.string().trim().optional(),
  price: z.coerce.number().nonnegative().optional().or(z.literal('')),
});
type CreateAssetForm = z.infer<typeof createAssetSchema>;

function CreateAssetForm({ categories, onClose }: { categories: AssetCategory[]; onClose: () => void }) {
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
        body: JSON.stringify({ ...values, categoryId: values.categoryId || undefined, price: values.price === '' ? undefined : values.price }),
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
      className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-900/40"
      noValidate
    >
      <div className="flex items-center justify-between sm:col-span-3">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">เพิ่มทรัพย์สิน</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

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

      <div className="sm:col-span-3">
        <Button type="submit" size="sm" isLoading={isSubmitting} data-testid="asset-create-submit">
          บันทึก
        </Button>
      </div>
    </form>
  );
}

export function AssetsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);

  const categoriesQuery = useQuery({
    queryKey: ['admin', 'asset-categories'],
    queryFn: () => apiFetch<AssetCategory[]>('/api/v1/asset-categories'),
  });

  const assetsQuery = useQuery({
    queryKey: ['assets', page, status, categoryId, debouncedSearch],
    queryFn: () =>
      apiFetch<PaginatedResult<Asset>>(
        `/api/v1/assets?page=${page}&pageSize=20${status ? `&status=${encodeURIComponent(status)}` : ''}${categoryId ? `&categoryId=${categoryId}` : ''}${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`,
      ),
  });

  const categoryById = new Map((categoriesQuery.data ?? []).map((c) => [c.id, c.name]));
  const items = assetsQuery.data?.items ?? [];
  const kpi = {
    total: assetsQuery.data?.pagination.totalItems ?? 0,
    available: items.filter((a) => a.status === 'พร้อมใช้งาน').length,
    inUse: items.filter((a) => a.status === 'ใช้งานอยู่').length,
    maintenance: items.filter((a) => a.status === 'ซ่อมบำรุง').length,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">ทะเบียนทรัพย์สิน IT</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Asset Register — ยืม/คืน/โอนย้าย/ส่งซ่อม/ตรวจนับ</p>
        </div>
        <RequirePermission permission="asset.create">
          <Button size="sm" onClick={() => setShowCreate((v) => !v)} data-testid="asset-create-toggle">
            <Plus className="h-4 w-4" aria-hidden="true" />
            เพิ่มทรัพย์สิน
          </Button>
        </RequirePermission>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Boxes className="h-5 w-5" aria-hidden="true" />} label="ทั้งหมด" value={kpi.total} tone="primary" />
        <StatCard icon={<Boxes className="h-5 w-5" aria-hidden="true" />} label="พร้อมใช้งาน (หน้านี้)" value={kpi.available} tone="teal" />
        <StatCard icon={<Boxes className="h-5 w-5" aria-hidden="true" />} label="ใช้งานอยู่ (หน้านี้)" value={kpi.inUse} tone="gray" />
        <StatCard icon={<Boxes className="h-5 w-5" aria-hidden="true" />} label="ซ่อมบำรุง (หน้านี้)" value={kpi.maintenance} tone="amber" />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <span>รายการทรัพย์สิน</span>
          <div className="flex flex-wrap items-center gap-2 text-xs font-normal">
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
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
                setStatus(e.target.value);
                setPage(1);
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
          {showCreate && categoriesQuery.data && <CreateAssetForm categories={categoriesQuery.data} onClose={() => setShowCreate(false)} />}

          <input
            type="search"
            placeholder="ค้นหาชื่อ รหัสทรัพย์สิน หรือ S/N..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="mb-3 w-full max-w-sm rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          />

          {assetsQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}

          {assetsQuery.data && items.length === 0 && <EmptyState icon={<Boxes className="h-10 w-10" aria-hidden="true" />} title="ไม่พบทรัพย์สิน" />}

          {assetsQuery.data && items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">รหัส</th>
                    <th className="px-2 py-2">ชื่อทรัพย์สิน</th>
                    <th className="px-2 py-2">หมวดหมู่</th>
                    <th className="px-2 py-2">ผู้ถือครอง</th>
                    <th className="px-2 py-2">สถานที่</th>
                    <th className="px-2 py-2">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id} data-testid={`asset-row-${a.id}`} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-2 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{a.asset_code}</td>
                      <td className="px-2 py-2">
                        <Link to={`/assets/${a.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
                          {a.name}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">
                        {a.category?.name ?? (a.category_id ? categoryById.get(a.category_id) : null) ?? '—'}
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">
                        {a.owner ? `${a.owner.first_name_th} ${a.owner.last_name_th}` : '—'}
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{a.location ?? '—'}</td>
                      <td className="px-2 py-2">
                        <Badge variant={assetStatusTone[a.status]}>{a.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {assetsQuery.data && assetsQuery.data.pagination.totalPages > 1 && (
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
                หน้า {assetsQuery.data.pagination.page} / {assetsQuery.data.pagination.totalPages}
              </span>
              <button
                type="button"
                disabled={page >= assetsQuery.data.pagination.totalPages}
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
