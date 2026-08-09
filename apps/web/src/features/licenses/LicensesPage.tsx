import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { PaginatedResult } from '../../types/admin';
import type { SoftwareLicense } from '../../types/assets';
import type { ContractOption, ContractVendorRef } from '../../types/vendorsContracts';
import { LICENSE_STATUSES } from '../../types/assets';
import { formatThaiDate } from '../../utils/date';

const statusTone: Record<string, 'success' | 'danger' | 'secondary'> = {
  Active: 'success',
  Expired: 'danger',
  Inactive: 'secondary',
};

function CreateLicenseForm({ vendors, contracts, onClose }: { vendors: ContractVendorRef[]; contracts: ContractOption[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [softwareName, setSoftwareName] = useState('');
  const [licenseType, setLicenseType] = useState('');
  const [totalQty, setTotalQty] = useState('1');
  const [usedQty, setUsedQty] = useState('0');
  const [expireDate, setExpireDate] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [contractId, setContractId] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/software-licenses', {
        method: 'POST',
        body: JSON.stringify({
          softwareName,
          licenseType: licenseType || undefined,
          totalQty: Number(totalQty) || 0,
          usedQty: Number(usedQty) || 0,
          expireDate: expireDate || undefined,
          vendorId: vendorId || undefined,
          contractId: contractId || undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['software-licenses'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เพิ่ม License ไม่สำเร็จ'),
  });

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex items-center justify-between sm:col-span-3">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">เพิ่ม Software License</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ชื่อซอฟต์แวร์</label>
        <input data-testid="lic-create-name" value={softwareName} onChange={(e) => setSoftwareName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ประเภท</label>
        <input value={licenseType} onChange={(e) => setLicenseType(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">จำนวนทั้งหมด</label>
        <input type="number" min="0" value={totalQty} onChange={(e) => setTotalQty(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">จำนวนที่ใช้แล้ว</label>
        <input type="number" min="0" value={usedQty} onChange={(e) => setUsedQty(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">วันหมดอายุ</label>
        <input type="date" value={expireDate} onChange={(e) => setExpireDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้จำหน่าย</label>
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">— ไม่ระบุ —</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_code} — {vendor.name}</option>)}</select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สัญญา</label>
        <select value={contractId} onChange={(e) => setContractId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">— ไม่ระบุ —</option>{contracts.filter((contract) => !vendorId || contract.vendor_id === vendorId).map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_number} — {contract.name}</option>)}</select>
      </div>
      {serverError && <p className="text-xs text-red-600 sm:col-span-3">{serverError}</p>}
      <div className="sm:col-span-3">
        <Button size="sm" isLoading={mutation.isPending} disabled={!softwareName.trim()} data-testid="lic-create-submit" onClick={() => mutation.mutate()}>
          บันทึก License
        </Button>
      </div>
    </div>
  );
}

export function LicensesPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const licensesQuery = useQuery({
    queryKey: ['software-licenses', status, search],
    queryFn: () =>
      apiFetch<PaginatedResult<SoftwareLicense>>(
        `/api/v1/software-licenses?page=1&pageSize=50${status ? `&status=${status}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
  });
  const vendorOptionsQuery = useQuery({ queryKey: ['vendors-contracts', 'vendor-options'], queryFn: () => apiFetch<ContractVendorRef[]>('/api/v1/vendors/options') });
  const contractOptionsQuery = useQuery({ queryKey: ['vendors-contracts', 'contract-options'], queryFn: () => apiFetch<ContractOption[]>('/api/v1/contracts/options') });

  const checkExpiryMutation = useMutation({
    mutationFn: () => apiFetch<{ updatedCount: number }>('/api/v1/software-licenses/check-expiry', { method: 'POST', body: '{}' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['software-licenses'] }),
  });

  const items = licensesQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Software License</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">ทะเบียนสิทธิ์การใช้งานซอฟต์แวร์และวันหมดอายุ</p>
        </div>
        <div className="flex gap-2">
          <RequirePermission permission="license.manage">
            <Button size="sm" variant="outline" isLoading={checkExpiryMutation.isPending} data-testid="lic-check-expiry" onClick={() => checkExpiryMutation.mutate()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              ตรวจสอบวันหมดอายุ
            </Button>
          </RequirePermission>
          <RequirePermission permission="license.manage">
            <Button size="sm" onClick={() => setShowCreate((v) => !v)} data-testid="lic-create-toggle">
              <Plus className="h-4 w-4" aria-hidden="true" />
              เพิ่ม License
            </Button>
          </RequirePermission>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <span>รายการ License</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-full border border-slate-300 px-3 py-1 text-xs dark:border-slate-600 dark:bg-slate-900">
            <option value="">ทุกสถานะ</option>
            {LICENSE_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </CardHeader>
        <CardBody>
          {showCreate && vendorOptionsQuery.data && contractOptionsQuery.data && <CreateLicenseForm vendors={vendorOptionsQuery.data} contracts={contractOptionsQuery.data} onClose={() => setShowCreate(false)} />}

          <input
            type="search"
            placeholder="ค้นหาชื่อซอฟต์แวร์ หรือผู้จำหน่าย..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-3 w-full max-w-sm rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
          />

          {licensesQuery.isLoading && (
            <div className="flex justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          )}
          {licensesQuery.data && items.length === 0 && <EmptyState icon={<KeyRound className="h-10 w-10" aria-hidden="true" />} title="ไม่พบ License" />}

          {items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">ซอฟต์แวร์</th>
                    <th className="px-2 py-2">จำนวน (ใช้/ทั้งหมด)</th>
                    <th className="px-2 py-2">หมดอายุ</th>
                    <th className="px-2 py-2">ผู้จำหน่าย</th>
                    <th className="px-2 py-2">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((l) => (
                    <tr key={l.id} data-testid={`lic-row-${l.id}`} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200">{l.software_name}</td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{l.used_qty} / {l.total_qty}</td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{l.expire_date ? formatThaiDate(l.expire_date, 'd MMM yyyy') : '—'}</td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{l.vendor?.name ?? l.vendor_name ?? '—'}{l.contract && <p className="text-xs text-slate-400">{l.contract.contract_number}</p>}</td>
                      <td className="px-2 py-2">
                        <Badge variant={statusTone[l.status]}>{l.status}</Badge>
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
