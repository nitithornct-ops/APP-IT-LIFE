import { DataTable, TablePagination } from '../../components/table/DataTable';
import { useTableParams } from '../../hooks/useTableParams';
import { ExportCsvButton } from '../../components/table/ExportCsvButton';
import { FormModal } from '../../components/ui/Modal';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, GitBranch, Loader2, Network, Plus, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { RowActions } from '../../components/table/RowActions';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { QueryError } from '../../components/ui/QueryError';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { EmployeeOption, PaginatedResult } from '../../types/admin';
import type { AssetOption } from '../../types/assets';
import type { CmdbDataQuality, ConfigurationItem } from '../../types/cmdb';
import type { ContractOption, ContractVendorRef } from '../../types/vendorsContracts';
import { CI_CRITICALITIES, CI_ENVIRONMENTS, CI_STATUSES, CI_TYPES, ciStatusTone, criticalityTone, employeeName } from './cmdbDisplay';

const createCiSchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อ CI'),
  ciType: z.enum(CI_TYPES),
  environment: z.enum(CI_ENVIRONMENTS),
  ownerEmployeeId: z.string().min(1, 'กรุณาเลือกเจ้าของ CI'),
  administratorEmployeeId: z.string().min(1, 'กรุณาเลือกผู้ดูแล CI'),
  criticality: z.enum(CI_CRITICALITIES).optional(),
  assetId: z.string().optional(),
  vendorId: z.string().optional(),
  contractId: z.string().optional(),
  ipAddress: z.string().trim().optional(),
  location: z.string().trim().optional(),
});
type CreateCiForm = z.infer<typeof createCiSchema>;

function CreateCiForm({ employees, assetOptions, vendorOptions, contractOptions, onClose }: { employees: EmployeeOption[]; assetOptions: AssetOption[]; vendorOptions: ContractVendorRef[]; contractOptions: ContractOption[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateCiForm>({ resolver: zodResolver(createCiSchema) });

  const mutation = useMutation({
    mutationFn: (values: CreateCiForm) =>
      apiFetch('/api/v1/cmdb/items', { method: 'POST', body: JSON.stringify({ ...values, assetId: values.assetId || undefined, vendorId: values.vendorId || undefined, contractId: values.contractId || undefined }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cmdb', 'items'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เพิ่ม CI ไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-900/40"
      noValidate
    >
      <div className="flex items-center justify-between sm:col-span-3">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">เพิ่ม Configuration Item</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="ci-name" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ชื่อ CI</label>
        <input id="ci-name" data-testid="ci-create-name" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('name')} />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>

      <div>
        <label htmlFor="ci-type" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ประเภท</label>
        <select id="ci-type" data-testid="ci-create-type" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('ciType')}>
          {CI_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="ci-env" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Environment</label>
        <select id="ci-env" data-testid="ci-create-environment" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('environment')}>
          {CI_ENVIRONMENTS.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="ci-criticality" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Criticality</label>
        <select id="ci-criticality" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('criticality')}>
          {CI_CRITICALITIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="ci-owner" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">เจ้าของ (Owner)</label>
        <select id="ci-owner" data-testid="ci-create-owner" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('ownerEmployeeId')}>
          <option value="">— เลือก —</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{employeeName(e)}</option>
          ))}
        </select>
        {errors.ownerEmployeeId && <p className="mt-1 text-xs text-red-600">{errors.ownerEmployeeId.message}</p>}
      </div>

      <div>
        <label htmlFor="ci-admin" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้ดูแล (Administrator)</label>
        <select id="ci-admin" data-testid="ci-create-administrator" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('administratorEmployeeId')}>
          <option value="">— เลือก —</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{employeeName(e)}</option>
          ))}
        </select>
        {errors.administratorEmployeeId && <p className="mt-1 text-xs text-red-600">{errors.administratorEmployeeId.message}</p>}
      </div>

      <div>
        <label htmlFor="ci-asset" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผูก Asset (ถ้ามี)</label>
        <select id="ci-asset" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('assetId')}>
          <option value="">— ไม่ผูก —</option>
          {assetOptions.map((a) => (
            <option key={a.id} value={a.id}>{a.asset_code} — {a.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="ci-vendor" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Vendor</label>
        <select id="ci-vendor" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('vendorId')}>
          <option value="">— ไม่ผูก —</option>
          {vendorOptions.map((v) => <option key={v.id} value={v.id}>{v.vendor_code} — {v.name}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor="ci-contract" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Contract</label>
        <select id="ci-contract" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('contractId')}>
          <option value="">— ไม่ผูก —</option>
          {contractOptions.map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_number} — {contract.name}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor="ci-ip" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">IP Address</label>
        <input id="ci-ip" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('ipAddress')} />
      </div>

      <div>
        <label htmlFor="ci-location" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สถานที่</label>
        <input id="ci-location" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('location')} />
      </div>

      {serverError && <p className="text-xs text-red-600 sm:col-span-3">{serverError}</p>}

      <div className="sm:col-span-3">
        <Button type="submit" size="sm" isLoading={isSubmitting} data-testid="ci-create-submit">
          บันทึก
        </Button>
      </div>
    </form>
  );
}

function DataQualityPanel() {
  const dqQuery = useQuery({ queryKey: ['cmdb', 'data-quality'], queryFn: () => apiFetch<CmdbDataQuality>('/api/v1/cmdb/items/data-quality') });
  if (!dqQuery.data) return null;
  const dq = dqQuery.data;

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        <span>คุณภาพข้อมูล CMDB (Data Quality)</span>
      </CardHeader>
      <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <p className="text-xs text-slate-500 dark:text-slate-400">ยังไม่เคยตรวจสอบ (Verify)</p>
          <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{dq.unverifiedCount}</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <p className="text-xs text-slate-500 dark:text-slate-400">High/Critical ข้อมูลไม่ครบ</p>
          <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{dq.incompleteCount}</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <p className="text-xs text-slate-500 dark:text-slate-400">ความสัมพันธ์ orphan/หมดอายุ</p>
          <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{dq.orphanCount + dq.expiredCount}</p>
        </div>
      </CardBody>
    </Card>
  );
}

function ImpactMap({ items }: { items: ConfigurationItem[] }) {
  const layers = [
    { label: 'BUSINESS SERVICE', types: ['Business Service'] },
    { label: 'APPLICATION', types: ['Application', 'Website', 'API'] },
    { label: 'COMPUTE & DATA', types: ['Server', 'VM', 'Database', 'Cloud Service'] },
    { label: 'DEVICE & NETWORK', types: ['Network Device', 'Firewall', 'Switch', 'Access Point'] },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-primary-600" />ผังผลกระทบแบบเป็นชั้น</span>
        <Link to="/cmdb/relationships" className="text-xs font-semibold text-primary-700 hover:underline dark:text-primary-300">จัดการความสัมพันธ์ CI</Link>
      </CardHeader>
      <CardBody className="bg-slate-50/80 dark:bg-slate-950/30">
        <p className="mb-4 text-xs text-slate-500">สรุปจาก CI ในหน้าปัจจุบัน เรียงจากบริการธุรกิจลงสู่อุปกรณ์ เพื่อให้เห็นจุดที่ควรเริ่มวิเคราะห์ผลกระทบ</p>
        <div className="grid gap-0 lg:grid-cols-4">
          {layers.map((layer, layerIndex) => {
            const nodes = items.filter((item) => layer.types.includes(item.ci_type)).slice(0, 4);
            return (
              <div key={layer.label} className="relative min-w-0 border-b border-slate-200 py-3 last:border-b-0 lg:border-b-0 lg:border-r lg:px-3 lg:first:pl-0 lg:last:border-r-0 lg:last:pr-0 dark:border-slate-700">
                <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-semibold tracking-wider text-slate-500"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-100 text-primary-700 dark:bg-primary-950 dark:text-primary-300">{layerIndex + 1}</span>{layer.label}</div>
                <div className="space-y-2">
                  {nodes.map((node) => (
                    <Link key={node.id} to={`/cmdb/${node.id}`} className={`block rounded-lg border bg-white p-2.5 transition hover:border-primary-300 hover:shadow-sm dark:bg-slate-900 ${node.status === 'Degraded' ? 'border-red-300 shadow-[inset_3px_0_0_#dc2626] dark:border-red-800' : node.criticality === 'Critical' ? 'border-amber-300 dark:border-amber-800' : 'border-slate-200 dark:border-slate-700'}`}>
                      <div className="flex items-center justify-between gap-2"><span className="truncate font-mono text-[10px] text-primary-700 dark:text-primary-300">{node.ci_code}</span><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${node.status === 'Active' ? 'bg-green-600' : node.status === 'Degraded' ? 'bg-red-600' : 'bg-amber-500'}`} /></div>
                      <p className="mt-1 truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{node.name}</p>
                      <p className="mt-0.5 truncate text-[10px] text-slate-500">{node.environment} · {node.status}</p>
                    </Link>
                  ))}
                  {nodes.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 px-2 py-4 text-center text-[11px] text-slate-400 dark:border-slate-700">ไม่พบ CI ชั้นนี้</div>}
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

export function CmdbPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [showDataQuality, setShowDataQuality] = useState(false);
  const table = useTableParams<'ciType' | 'environment' | 'status' | 'search'>({ filters: ['ciType', 'environment', 'status', 'search'] });
  const { page, pageSize } = table;
  const { ciType, environment, status, search } = table.filters;
  const debouncedSearch = useDebouncedValue(search);

  const employeesQuery = useQuery({ queryKey: ['employee-options'], queryFn: () => apiFetch<EmployeeOption[]>('/api/v1/employees/options') });
  const assetOptionsQuery = useQuery({ queryKey: ['assets', 'options'], queryFn: () => apiFetch<AssetOption[]>('/api/v1/assets/options') });
  const vendorOptionsQuery = useQuery({ queryKey: ['vendors-contracts', 'vendor-options'], queryFn: () => apiFetch<ContractVendorRef[]>('/api/v1/vendors/options'), enabled: showCreate });
  const contractOptionsQuery = useQuery({ queryKey: ['vendors-contracts', 'contract-options'], queryFn: () => apiFetch<ContractOption[]>('/api/v1/contracts/options'), enabled: showCreate });

  const itemsQuery = useQuery({
    queryKey: ['cmdb', 'items', page, pageSize, ciType, environment, status, debouncedSearch],
    queryFn: () =>
      apiFetch<PaginatedResult<ConfigurationItem>>(
        `/api/v1/cmdb/items?page=${page}&pageSize=${pageSize}${ciType ? `&ciType=${encodeURIComponent(ciType)}` : ''}${environment ? `&environment=${encodeURIComponent(environment)}` : ''}${status ? `&status=${encodeURIComponent(status)}` : ''}${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`,
      ),
  });

  const items = itemsQuery.data?.items ?? [];
  const kpi = {
    total: itemsQuery.data?.pagination.totalItems ?? 0,
    active: items.filter((c) => c.status === 'Active').length,
    critical: items.filter((c) => c.criticality === 'Critical').length,
    degraded: items.filter((c) => c.status === 'Degraded').length,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">CMDB — Configuration Items</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">ทะเบียนโครงสร้าง IT เชิงบริการ (Server/Database/Application ฯลฯ)</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowDataQuality((v) => !v)}>
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Data Quality
          </Button>
          <RequirePermission permission="cmdb.manage">
            <Button size="sm" onClick={() => setShowCreate((v) => !v)} data-testid="ci-create-toggle">
              <Plus className="h-4 w-4" aria-hidden="true" />
              เพิ่ม CI
            </Button>
          </RequirePermission>
        </div>
      </div>

      {showDataQuality && <DataQualityPanel />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Network className="h-5 w-5" aria-hidden="true" />} label="ทั้งหมด" value={kpi.total} tone="primary" />
        <StatCard icon={<Network className="h-5 w-5" aria-hidden="true" />} label="Active (หน้านี้)" value={kpi.active} tone="teal" />
        <StatCard icon={<Network className="h-5 w-5" aria-hidden="true" />} label="Critical (หน้านี้)" value={kpi.critical} tone="amber" />
        <StatCard icon={<Network className="h-5 w-5" aria-hidden="true" />} label="Degraded (หน้านี้)" value={kpi.degraded} tone="gray" />
      </div>

      <ImpactMap items={items} />

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <span>รายการ Configuration Item</span>
          <div className="flex flex-wrap items-center gap-2 text-xs font-normal">
            <select value={ciType} onChange={(e) => table.setFilter('ciType', e.target.value)} className="rounded-full border border-slate-300 px-3 py-1 dark:border-slate-600 dark:bg-slate-900">
              <option value="">ทุกประเภท</option>
              {CI_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select value={environment} onChange={(e) => table.setFilter('environment', e.target.value)} className="rounded-full border border-slate-300 px-3 py-1 dark:border-slate-600 dark:bg-slate-900">
              <option value="">ทุก Environment</option>
              {CI_ENVIRONMENTS.map((env) => (
                <option key={env} value={env}>{env}</option>
              ))}
            </select>
            <select value={status} onChange={(e) => table.setFilter('status', e.target.value)} className="rounded-full border border-slate-300 px-3 py-1 dark:border-slate-600 dark:bg-slate-900">
              <option value="">ทุกสถานะ</option>
              {CI_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {showCreate && employeesQuery.data && assetOptionsQuery.data && vendorOptionsQuery.data && contractOptionsQuery.data && <FormModal title="เพิ่ม Configuration Item" description="บันทึก CI และความเชื่อมโยงกับ Asset, Vendor และ Contract" size="xl" onClose={() => setShowCreate(false)}><CreateCiForm employees={employeesQuery.data} assetOptions={assetOptionsQuery.data} vendorOptions={vendorOptionsQuery.data} contractOptions={contractOptionsQuery.data} onClose={() => setShowCreate(false)} /></FormModal>}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              type="search"
              placeholder="ค้นหาชื่อ, รหัส CI หรือ IP..."
              value={search}
              onChange={(e) => table.setFilter('search', e.target.value, { replace: true })}
              className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
            <ExportCsvButton
              disabled={!items.length}
              fileName={`cmdb-page-${page}.csv`}
              getRows={() => [
                ['รหัส', 'ชื่อ CI', 'ประเภท', 'Environment', 'Criticality', 'เจ้าของ', 'สถานะ'],
                ...items.map((c) => [c.ci_code, c.name, c.ci_type, c.environment, c.criticality, employeeName(c.owner), c.status]),
              ]}
            />
          </div>

          {itemsQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}

          {itemsQuery.isError && (
            <QueryError title="โหลดรายการ Configuration Item ไม่สำเร็จ" error={itemsQuery.error} onRetry={() => void itemsQuery.refetch()} isRetrying={itemsQuery.isFetching} />
          )}

          {!itemsQuery.isError && itemsQuery.data && items.length === 0 && <EmptyState icon={<Network className="h-10 w-10" aria-hidden="true" />} title="ไม่พบ Configuration Item" />}

          {itemsQuery.data && items.length > 0 && (
            <div className="overflow-x-auto">
              <DataTable mode="server" className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">รหัส</th>
                    <th className="px-2 py-2">ชื่อ CI</th>
                    <th className="px-2 py-2">ประเภท</th>
                    <th className="px-2 py-2">Environment</th>
                    <th className="px-2 py-2">Criticality</th>
                    <th className="px-2 py-2">เจ้าของ</th>
                    <th className="px-2 py-2">สถานะ</th>
                    <th className="px-2 py-2 text-right">ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id} data-testid={`ci-row-${c.id}`} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-2 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{c.ci_code}</td>
                      <td className="px-2 py-2">
                        <Link to={`/cmdb/${c.id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{c.ci_type}</td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{c.environment}</td>
                      <td className="px-2 py-2">
                        <Badge variant={criticalityTone[c.criticality]}>{c.criticality}</Badge>
                      </td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{employeeName(c.owner)}</td>
                      <td className="px-2 py-2">
                        <Badge variant={ciStatusTone[c.status]}>{c.status}</Badge>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <RowActions recordLabel={c.ci_code} actions={[{ kind: 'view', to: `/cmdb/${c.id}` }]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          )}

          {itemsQuery.data && <TablePagination page={itemsQuery.data.pagination.page} pageSize={pageSize} totalItems={itemsQuery.data.pagination.totalItems} totalPages={itemsQuery.data.pagination.totalPages} onPageChange={table.setPage} onPageSizeChange={table.setPageSize} />}
        </CardBody>
      </Card>
    </div>
  );
}
