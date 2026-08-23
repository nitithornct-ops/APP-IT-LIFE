import { DataTable } from '../../components/table/DataTable';
import { RowActions } from '../../components/table/RowActions';
import { FormModal } from '../../components/ui/Modal';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CircleGauge,
  KeyRound,
  Loader2,
  PackageSearch,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { PaginatedResult } from '../../types/admin';
import { LICENSE_STATUSES, type SoftwareLicense } from '../../types/assets';
import type { ContractOption, ContractVendorRef } from '../../types/vendorsContracts';
import { formatThaiDate } from '../../utils/date';
import { daysUntilLicenseExpiry, licenseHealth, remainingSeats, utilizationPercent, type LicenseHealth } from './licenseDisplay';

const LICENSE_TYPES = ['Subscription', 'Perpetual', 'Volume', 'OEM', 'Named User', 'Concurrent', 'Trial', 'อื่นๆ'] as const;
const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900';

const healthTone: Record<LicenseHealth, 'success' | 'warning' | 'danger' | 'secondary' | 'info'> = {
  active: 'success',
  expiring: 'warning',
  expired: 'danger',
  inactive: 'secondary',
  unlimited: 'info',
};

const healthLabel: Record<LicenseHealth, string> = {
  active: 'ใช้งาน',
  expiring: 'ใกล้หมดอายุ',
  expired: 'หมดอายุ',
  inactive: 'ปิดใช้งาน',
  unlimited: 'ไม่กำหนดอายุ',
};

interface LicenseFormState {
  softwareName: string;
  licenseType: string;
  totalQty: string;
  usedQty: string;
  startDate: string;
  expireDate: string;
  vendorId: string;
  contractId: string;
  assignedTo: string;
  expiryNoticeDays: string;
  notes: string;
}

function initialForm(license?: SoftwareLicense): LicenseFormState {
  return {
    softwareName: license?.software_name ?? '',
    licenseType: license?.license_type ?? 'Subscription',
    totalQty: String(license?.total_qty ?? 1),
    usedQty: String(license?.used_qty ?? 0),
    startDate: license?.start_date ?? '',
    expireDate: license?.expire_date ?? '',
    vendorId: license?.vendor_id ?? '',
    contractId: license?.contract_id ?? '',
    assignedTo: license?.assigned_to ?? '',
    expiryNoticeDays: String(license?.expiry_notice_days ?? 30),
    notes: license?.notes ?? '',
  };
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function LicenseForm({
  license,
  vendors,
  contracts,
  onClose,
}: {
  license?: SoftwareLicense;
  vendors: ContractVendorRef[];
  contracts: ContractOption[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => initialForm(license));
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof LicenseFormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const availableContracts = contracts.filter((contract) => !form.vendorId || contract.vendor_id === form.vendorId);

  const mutation = useMutation({
    mutationFn: () => {
      const totalQty = Number(form.totalQty);
      const usedQty = Number(form.usedQty);
      if (!Number.isFinite(totalQty) || !Number.isFinite(usedQty) || totalQty < 0 || usedQty < 0) {
        throw new Error('จำนวน License ต้องเป็นเลขตั้งแต่ 0 ขึ้นไป');
      }
      if (usedQty > totalQty) throw new Error('จำนวนที่ใช้ต้องไม่เกินจำนวนทั้งหมด');
      if (form.startDate && form.expireDate && form.expireDate < form.startDate) {
        throw new Error('วันหมดอายุต้องไม่ก่อนวันเริ่มต้น');
      }
      const expiryNoticeDays = Number(form.expiryNoticeDays);
      if (!Number.isInteger(expiryNoticeDays) || expiryNoticeDays < 0 || expiryNoticeDays > 3650) {
        throw new Error('จำนวนวันแจ้งเตือนต้องอยู่ระหว่าง 0–3650 วัน');
      }
      return apiFetch(license ? `/api/v1/software-licenses/${license.id}` : '/api/v1/software-licenses', {
        method: license ? 'PATCH' : 'POST',
        body: JSON.stringify({
          softwareName: form.softwareName,
          licenseType: form.licenseType || undefined,
          totalQty,
          usedQty,
          startDate: form.startDate,
          expireDate: form.expireDate,
          vendorId: form.vendorId,
          contractId: form.contractId,
          assignedTo: form.assignedTo,
          expiryNoticeDays,
          notes: form.notes,
        }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['software-licenses'] });
      onClose();
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : errorText(reason, 'บันทึก License ไม่สำเร็จ')),
  });

  return (
    <Card data-testid="license-form" className="border-primary-200 dark:border-primary-900">
      <CardHeader className="flex items-center justify-between">
        <div>
          <p>{license ? `แก้ไข ${license.software_name}` : 'เพิ่ม Software License'}</p>
          <p className="mt-0.5 text-xs font-normal text-slate-500">ข้อมูลสิทธิ์ใช้งาน ผู้จำหน่าย สัญญา และรอบอายุ</p>
        </div>
        <button type="button" aria-label="ปิดแบบฟอร์ม" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700">
          <X className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardBody>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            mutation.mutate();
          }}
        >
          <label className="text-xs font-semibold sm:col-span-2">
            ชื่อซอฟต์แวร์
            <input required maxLength={150} data-testid="lic-form-name" value={form.softwareName} onChange={(event) => set('softwareName', event.target.value)} className={fieldClass} />
          </label>
          <label className="text-xs font-semibold">
            ประเภท License
            <input list="license-types" maxLength={80} value={form.licenseType} onChange={(event) => set('licenseType', event.target.value)} className={fieldClass} />
            <datalist id="license-types">{LICENSE_TYPES.map((type) => <option key={type} value={type} />)}</datalist>
          </label>
          <label className="text-xs font-semibold">
            ผู้ใช้งาน / หน่วยงาน
            <input maxLength={200} value={form.assignedTo} onChange={(event) => set('assignedTo', event.target.value)} placeholder="เช่น พนักงานทุกหน่วยงาน" className={fieldClass} />
          </label>
          <label className="text-xs font-semibold">
            จำนวนทั้งหมด
            <input required type="number" min="0" step="1" data-testid="lic-form-total" value={form.totalQty} onChange={(event) => set('totalQty', event.target.value)} className={fieldClass} />
          </label>
          <label className="text-xs font-semibold">
            ใช้แล้ว
            <input required type="number" min="0" step="1" data-testid="lic-form-used" value={form.usedQty} onChange={(event) => set('usedQty', event.target.value)} className={fieldClass} />
          </label>
          <label className="text-xs font-semibold">
            วันที่เริ่มต้น
            <input type="date" value={form.startDate} onChange={(event) => set('startDate', event.target.value)} className={fieldClass} />
          </label>
          <label className="text-xs font-semibold">
            วันหมดอายุ
            <input type="date" data-testid="lic-form-expire" value={form.expireDate} onChange={(event) => set('expireDate', event.target.value)} className={fieldClass} />
          </label>
          <label className="text-xs font-semibold">
            แจ้งเตือนล่วงหน้า (วัน)
            <input type="number" min="0" max="3650" step="1" value={form.expiryNoticeDays} onChange={(event) => set('expiryNoticeDays', event.target.value)} className={fieldClass} />
          </label>
          <label className="text-xs font-semibold sm:col-span-2">
            ผู้จำหน่าย
            <select
              value={form.vendorId}
              onChange={(event) => {
                setForm((current) => ({ ...current, vendorId: event.target.value, contractId: '' }));
              }}
              className={fieldClass}
            >
              <option value="">— ไม่ระบุ —</option>
              {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_code} — {vendor.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold sm:col-span-2">
            สัญญาที่เกี่ยวข้อง
            <select value={form.contractId} onChange={(event) => set('contractId', event.target.value)} className={fieldClass}>
              <option value="">— ไม่ระบุ —</option>
              {availableContracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_number} — {contract.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold sm:col-span-2 lg:col-span-4">
            หมายเหตุ
            <textarea rows={3} maxLength={500} value={form.notes} onChange={(event) => set('notes', event.target.value)} className={fieldClass} />
          </label>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2 lg:col-span-4 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit" size="sm" isLoading={mutation.isPending} disabled={!form.softwareName.trim()} data-testid="lic-form-submit">
              <Save className="h-4 w-4" />{license ? 'บันทึกการแก้ไข' : 'บันทึก License'}
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>ยกเลิก</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function UsageEditor({ license, onClose }: { license: SoftwareLicense; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [usedQty, setUsedQty] = useState(String(license.used_qty));
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      const used = Number(usedQty);
      if (!Number.isFinite(used) || used < 0 || used > license.total_qty) throw new Error(`จำนวนที่ใช้ต้องอยู่ระหว่าง 0–${license.total_qty}`);
      return apiFetch(`/api/v1/software-licenses/${license.id}`, { method: 'PATCH', body: JSON.stringify({ usedQty: used }) });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['software-licenses'] });
      onClose();
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : 'บันทึกจำนวนสิทธิ์ไม่สำเร็จ'),
  });

  return (
    <div className="flex min-w-64 flex-col gap-2 rounded-xl border border-primary-200 bg-primary-50 p-3 dark:border-primary-900 dark:bg-primary-950/30">
      <div className="flex items-center justify-between"><p className="text-xs font-bold">ปรับจำนวนที่ใช้</p><button type="button" aria-label="ปิด" onClick={onClose}><X className="h-3.5 w-3.5" /></button></div>
      <p className="truncate text-xs text-slate-500">{license.software_name} · ทั้งหมด {license.total_qty}</p>
      <div className="flex gap-2">
        <input type="number" min="0" max={license.total_qty} value={usedQty} onChange={(event) => setUsedQty(event.target.value)} className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900" />
        <Button size="sm" isLoading={mutation.isPending} onClick={() => { setError(null); mutation.mutate(); }}>บันทึก</Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ExpiryText({ license }: { license: SoftwareLicense }) {
  const days = daysUntilLicenseExpiry(license.expire_date);
  if (!license.expire_date) return <span className="text-slate-400">ไม่กำหนด</span>;
  return (
    <div>
      <p>{formatThaiDate(license.expire_date, 'd MMM yyyy')}</p>
      {days !== null && days < 0 && <p className="text-xs font-semibold text-red-600">เลยกำหนด {Math.abs(days)} วัน</p>}
      {days !== null && days >= 0 && days <= 30 && <p className="text-xs font-semibold text-amber-600">เหลือ {days} วัน</p>}
      {days !== null && days > 30 && <p className="text-xs text-slate-400">เหลือ {days} วัน</p>}
    </div>
  );
}

export function LicensesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('license.manage');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SoftwareLicense | undefined>();
  const [editingUsageId, setEditingUsageId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const licensesQuery = useQuery({
    queryKey: ['software-licenses', debouncedSearch],
    queryFn: () => apiFetch<PaginatedResult<SoftwareLicense>>(`/api/v1/software-licenses?page=1&pageSize=100${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}`),
  });
  const vendorOptionsQuery = useQuery({
    queryKey: ['vendors-contracts', 'vendor-options'],
    enabled: canManage && showForm,
    queryFn: () => apiFetch<ContractVendorRef[]>('/api/v1/vendors/options'),
  });
  const contractOptionsQuery = useQuery({
    queryKey: ['vendors-contracts', 'contract-options'],
    enabled: canManage && showForm,
    queryFn: () => apiFetch<ContractOption[]>('/api/v1/contracts/options'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiFetch(`/api/v1/software-licenses/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['software-licenses'] }),
  });
  const checkExpiryMutation = useMutation({
    mutationFn: () => apiFetch<{ updatedCount: number; notifiedCount: number }>('/api/v1/software-licenses/check-expiry', { method: 'POST', body: '{}' }),
    onSuccess: (result) => {
      setNotice(`ตรวจสอบแล้ว · ปรับสถานะหมดอายุ ${result.updatedCount} รายการ · แจ้งเตือน ${result.notifiedCount} รายการ`);
      void queryClient.invalidateQueries({ queryKey: ['software-licenses'] });
    },
    onError: (reason) => setNotice(errorText(reason, 'ตรวจสอบวันหมดอายุไม่สำเร็จ')),
  });

  const items = useMemo(() => licensesQuery.data?.items ?? [], [licensesQuery.data?.items]);
  const types = useMemo(() => [...new Set([...LICENSE_TYPES, ...items.map((item) => item.license_type).filter((value): value is string => Boolean(value))])].sort(), [items]);
  const visibleItems = items.filter((item) => (!statusFilter || item.status === statusFilter) && (!typeFilter || item.license_type === typeFilter));
  const activeCount = items.filter((item) => licenseHealth(item) === 'active' || licenseHealth(item) === 'unlimited').length;
  const expiringCount = items.filter((item) => licenseHealth(item) === 'expiring').length;
  const expiredCount = items.filter((item) => licenseHealth(item) === 'expired').length;
  const totalSeats = items.reduce((sum, item) => sum + Number(item.total_qty), 0);
  const usedSeats = items.reduce((sum, item) => sum + Number(item.used_qty), 0);
  const overallUtilization = utilizationPercent(usedSeats, totalSeats);
  const overusedItems = items.filter((item) => Number(item.used_qty) > Number(item.total_qty));
  const unusedSeats = items.reduce((sum, item) => sum + Math.max(0, Number(item.total_qty) - Number(item.used_qty)), 0);
  const underusedItems = items.filter((item) => Number(item.total_qty) > 0 && Number(item.used_qty) / Number(item.total_qty) <= 0.75);
  const resetForm = () => { setShowForm(false); setEditing(undefined); };

  return (
    <div className="flex flex-col gap-4" data-testid="licenses-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Software License</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">ควบคุมจำนวนสิทธิ์ ผู้ใช้งาน สัญญา และรอบการต่ออายุซอฟต์แวร์</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" isLoading={checkExpiryMutation.isPending} data-testid="lic-check-expiry" onClick={() => { setNotice(null); checkExpiryMutation.mutate(); }}>
              <RefreshCw className="h-4 w-4" />ตรวจวันหมดอายุ
            </Button>
            <Button size="sm" data-testid="lic-create-toggle" onClick={() => { setEditing(undefined); setShowForm(true); }}>
              <Plus className="h-4 w-4" />เพิ่ม License
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard icon={<KeyRound className="h-5 w-5" />} label="License ทั้งหมด" value={licensesQuery.data?.pagination.totalItems ?? 0} tone="primary" />
        <StatCard icon={<ShieldCheck className="h-5 w-5" />} label="พร้อมใช้งาน" value={activeCount} tone="teal" />
        <StatCard icon={<CalendarClock className="h-5 w-5" />} label="ใกล้หมดใน 30 วัน" value={expiringCount} tone={expiringCount ? 'amber' : 'gray'} />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="หมดอายุแล้ว" value={expiredCount} tone={expiredCount ? 'danger' : 'gray'} />
        <StatCard icon={<CircleGauge className="h-5 w-5" />} label="อัตราการใช้งาน" value={`${overallUtilization}%`} note={overusedItems.length ? `ใช้เกิน ${overusedItems.length} รายการ` : `${usedSeats.toLocaleString('th-TH')} / ${totalSeats.toLocaleString('th-TH')} สิทธิ์`} tone={overusedItems.length ? 'danger' : overallUtilization >= 90 ? 'amber' : 'primary'} />
      </div>

      {notice && (
        <div className="flex items-center justify-between rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-800 dark:border-primary-900 dark:bg-primary-950/30 dark:text-primary-200">
          <span>{notice}</span><button type="button" aria-label="ปิดข้อความ" onClick={() => setNotice(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      {showForm && <FormModal title={editing ? 'แก้ไข Software License' : 'เพิ่ม Software License'} description="จัดการจำนวนสิทธิ์ Vendor Contract และวันหมดอายุ" size="xl" onClose={resetForm}>{vendorOptionsQuery.isLoading || contractOptionsQuery.isLoading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />กำลังเตรียมข้อมูลแบบฟอร์ม</div> : vendorOptionsQuery.isError || contractOptionsQuery.isError ? <div className="flex items-center justify-between gap-3 p-5 text-sm text-red-700 dark:text-red-300"><span>โหลดข้อมูล Vendor/Contract สำหรับแบบฟอร์มไม่สำเร็จ</span><Button size="sm" variant="ghost" onClick={resetForm}>ปิด</Button></div> : <LicenseForm license={editing} vendors={vendorOptionsQuery.data ?? []} contracts={contractOptionsQuery.data ?? []} onClose={resetForm} />}</FormModal>}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="min-w-0">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p>ทะเบียน Software License</p>
            <p className="mt-0.5 text-xs font-normal text-slate-500">ติดตามสิทธิ์คงเหลือและรายการที่ต้องต่ออายุ</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select aria-label="กรองประเภท License" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="rounded-full border border-slate-300 px-3 py-1 text-xs dark:border-slate-600 dark:bg-slate-900">
              <option value="">ทุกประเภท</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <select aria-label="กรองสถานะ License" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-full border border-slate-300 px-3 py-1 text-xs dark:border-slate-600 dark:bg-slate-900">
              <option value="">ทุกสถานะ</option>{LICENSE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input type="search" placeholder="ค้นหาชื่อซอฟต์แวร์ ผู้จำหน่าย หรือผู้ใช้งาน..." value={search} onChange={(event) => setSearch(event.target.value)} className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
            {(statusFilter || typeFilter || search) && <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setStatusFilter(''); setTypeFilter(''); }}>ล้างตัวกรอง</Button>}
          </div>

          {licensesQuery.isLoading && <div className="flex justify-center py-10" role="status"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
          {licensesQuery.isError && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{errorText(licensesQuery.error, 'โหลดทะเบียน License ไม่สำเร็จ')}</div>}
          {!licensesQuery.isLoading && !licensesQuery.isError && visibleItems.length === 0 && <EmptyState icon={<KeyRound className="h-10 w-10" />} title="ไม่พบ Software License" message="ลองเปลี่ยนคำค้นหาหรือตัวกรองสถานะ" />}

          {visibleItems.length > 0 && (
            <div className="overflow-x-auto">
              <DataTable tableId="licenses" className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="p-2">ซอฟต์แวร์</th>
                    <th className="p-2">การใช้งาน</th>
                    <th className="p-2">รอบอายุ</th>
                    <th className="p-2">Vendor / Contract</th>
                    <th className="p-2">ผู้ใช้งาน</th>
                    <th className="p-2">สถานะ</th>
                    <th className="p-2 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((license) => {
                    const health = licenseHealth(license);
                    const utilization = utilizationPercent(license.used_qty, license.total_qty);
                    const expanded = expandedId === license.id;
                    return (
                      <Fragment key={license.id}>
                        <tr data-testid={`lic-row-${license.id}`} className={`border-t align-top ${Number(license.used_qty) > Number(license.total_qty) ? 'border-red-200 bg-red-50/50 shadow-[inset_3px_0_0_#dc2626] dark:border-red-900 dark:bg-red-950/10' : 'border-slate-100 dark:border-slate-700'}`}>
                          <td className="p-2">
                            <p className="font-semibold text-slate-800 dark:text-slate-100">{license.software_name}</p>
                            <p className="font-mono text-xs text-primary-700 dark:text-primary-300">{license.license_code}</p>
                            <p className="text-xs text-slate-400">{license.license_type || 'ไม่ระบุประเภท'}</p>
                          </td>
                          <td className="min-w-44 p-2">
                            <div className="flex items-center justify-between text-xs"><span>{license.used_qty} / {license.total_qty}</span><span className={`font-semibold ${Number(license.used_qty) > Number(license.total_qty) ? 'text-red-700 dark:text-red-300' : ''}`}>{utilization}%</span></div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className={`h-full rounded-full ${Number(license.used_qty) > Number(license.total_qty) ? 'bg-red-600' : utilization >= 90 ? 'bg-amber-500' : 'bg-primary-600'}`} style={{ width: `${utilization}%` }} /></div>
                            <p className={`mt-1 text-xs ${Number(license.used_qty) > Number(license.total_qty) ? 'font-semibold text-red-700 dark:text-red-300' : 'text-slate-400'}`}>{Number(license.used_qty) > Number(license.total_qty) ? `ใช้เกิน ${Number(license.used_qty) - Number(license.total_qty)} สิทธิ์` : `คงเหลือ ${remainingSeats(license.used_qty, license.total_qty)} สิทธิ์`}</p>
                          </td>
                          <td className="p-2 text-slate-500 dark:text-slate-400"><ExpiryText license={license} /></td>
                          <td className="max-w-56 p-2 text-slate-500 dark:text-slate-400">
                            <p className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{license.vendor?.name ?? license.vendor_name ?? '—'}</p>
                            {license.contract && <p className="mt-1 font-mono text-xs text-primary-700 dark:text-primary-300">{license.contract.contract_number}</p>}
                          </td>
                          <td className="max-w-48 p-2 text-slate-500 dark:text-slate-400"><p className="flex items-start gap-1"><Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />{license.assigned_to || '—'}</p></td>
                          <td className="p-2"><Badge variant={healthTone[health]}>{healthLabel[health]}</Badge></td>
                          <td className="p-2">
                            <RowActions
                              recordLabel={license.software_name}
                              actions={[
                                { kind: 'view', icon: expanded ? ChevronUp : ChevronDown, label: expanded ? 'ย่อ' : 'รายละเอียด', onClick: () => setExpandedId(expanded ? null : license.id) },
                                { kind: 'custom', icon: KeyRound, label: 'สิทธิ์', permission: 'license.manage', onClick: () => setEditingUsageId(editingUsageId === license.id ? null : license.id) },
                                { kind: 'edit', permission: 'license.manage', onClick: () => { setEditing(license); setShowForm(true); } },
                              ]}
                            />
                            {editingUsageId === license.id && <div className="mt-2"><UsageEditor license={license} onClose={() => setEditingUsageId(null)} /></div>}
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-t border-slate-100 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-900/40">
                            <td colSpan={7} className="p-4">
                              <div className="grid gap-4 text-xs sm:grid-cols-2 lg:grid-cols-5">
                                <div><p className="font-semibold text-slate-500">วันที่เริ่มต้น</p><p className="mt-1">{license.start_date ? formatThaiDate(license.start_date) : '—'}</p></div>
                                <div><p className="font-semibold text-slate-500">วันหมดอายุ</p><p className="mt-1">{license.expire_date ? formatThaiDate(license.expire_date) : 'ไม่กำหนด'}</p></div>
                                <div><p className="font-semibold text-slate-500">สัญญา</p><p className="mt-1">{license.contract?.name ?? '—'}</p></div>
                                <div><p className="font-semibold text-slate-500">แจ้งเตือนล่วงหน้า</p><p className="mt-1">{license.expiry_notice_days} วัน</p></div>
                                <div><p className="font-semibold text-slate-500">หมายเหตุ</p><p className="mt-1 whitespace-pre-wrap">{license.notes || '—'}</p></div>
                              </div>
                              {canManage && (
                                <div className="mt-4 flex items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
                                  <label className="text-xs font-semibold">สถานะระบบ</label>
                                  <select aria-label={`สถานะ ${license.software_name}`} value={license.status} disabled={statusMutation.isPending} onChange={(event) => statusMutation.mutate({ id: license.id, status: event.target.value })} className="rounded-lg border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900">
                                    {LICENSE_STATUSES.map((status) => <option key={status}>{status}</option>)}
                                  </select>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </DataTable>
            </div>
          )}
        </CardBody>
      </Card>

      <aside className="flex min-w-0 flex-col gap-3" aria-label="สรุปประสิทธิภาพลิขสิทธิ์">
        <div className="rounded-[10px] bg-[#0B1B36] p-4 text-white shadow-sm">
          <p className="font-mono text-[10px] font-semibold tracking-wider text-white/50">LICENSE OPTIMIZATION</p>
          <p className="mt-3 text-sm font-bold">สิทธิ์ที่ยังไม่ถูกใช้งาน</p>
          <p className="mt-1 font-mono text-3xl font-bold text-blue-300">{unusedSeats.toLocaleString('th-TH')}</p>
          <p className="mt-1 text-xs leading-5 text-white/60">จาก {underusedItems.length} รายการที่ใช้งานไม่เกิน 75% ควรทบทวนก่อนรอบต่ออายุครั้งถัดไป</p>
          <button type="button" onClick={() => { setStatusFilter('Active'); setTypeFilter(''); }} className="mt-4 w-full rounded-lg bg-primary-600 px-3 py-2 text-xs font-bold hover:bg-primary-700">ตรวจรายการที่ใช้งานอยู่</button>
        </div>

        {overusedItems.length > 0 && <div className="rounded-[10px] border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/20"><p className="flex items-center gap-2 text-xs font-bold text-red-700 dark:text-red-300"><AlertTriangle className="h-4 w-4" />ใช้เกินสิทธิ์ที่ซื้อ</p><div className="mt-3 space-y-2">{overusedItems.slice(0, 4).map((item) => <div key={item.id} className="flex items-start justify-between gap-3 text-xs"><span className="min-w-0 truncate font-semibold">{item.software_name}</span><span className="shrink-0 font-mono font-bold text-red-700 dark:text-red-300">+{Number(item.used_qty) - Number(item.total_qty)}</span></div>)}</div><p className="mt-3 text-[11px] leading-5 text-slate-600 dark:text-slate-300">ลดจำนวนผู้ใช้หรือเพิ่มสิทธิ์ให้ตรงกับการติดตั้งจริง เพื่อปิดความเสี่ยงด้าน compliance</p></div>}

        <Link to="/inventory-items" className="rounded-[10px] border border-slate-200 bg-white p-4 transition hover:border-primary-300 dark:border-slate-700 dark:bg-slate-900"><p className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100"><PackageSearch className="h-4 w-4 text-primary-600" />คลังอะไหล่และวัสดุ</p><p className="mt-2 text-xs text-slate-500">ตรวจสต็อกต่ำ จุดสั่งซื้อ และประวัติการเบิก</p></Link>
      </aside>
      </div>
    </div>
  );
}
