import { DataTable } from '../../components/table/DataTable';
import { RowActions } from '../../components/table/RowActions';
import { FormModal } from '../../components/ui/Modal';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarClock, ClipboardCheck, FileText, Loader2, Plus, RefreshCw, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { PaginatedResult } from '../../types/admin';
import {
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  VENDOR_SERVICE_TYPES,
  type Contract,
  type ContractReferences,
  type Vendor,
  type VendorReferences,
} from '../../types/vendorsContracts';
import { formatThaiDate } from '../../utils/date';
import { contractStatusTone, daysUntilDate, effectiveContractState, profileName, vendorStatusTone } from './vendorContractDisplay';

const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900';
type ActiveTab = 'vendors' | 'contracts';

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function VendorForm({ vendor, references, onClose }: { vendor?: Vendor; references: VendorReferences; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: vendor?.name ?? '', serviceType: vendor?.service_type ?? 'อื่นๆ', serviceScope: vendor?.service_scope ?? '',
    contactPerson: vendor?.contact_person ?? '', phone: vendor?.phone ?? '', email: vendor?.email ?? '',
    contactInfo: vendor?.contact_info ?? '', ownerId: vendor?.owner_id ?? '', notes: vendor?.notes ?? '',
    contractNumber: '', contractStart: '', contractEnd: '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const mutation = useMutation({
    mutationFn: () => apiFetch<Vendor>(vendor ? `/api/v1/vendors/${vendor.id}` : '/api/v1/vendors', {
      method: vendor ? 'PATCH' : 'POST',
      body: JSON.stringify({
        name: form.name, serviceType: form.serviceType, serviceScope: form.serviceScope,
        contactPerson: form.contactPerson, phone: form.phone, email: form.email,
        contactInfo: form.contactInfo, ownerId: form.ownerId || null, notes: form.notes,
        ...(!vendor && form.contractNumber ? { initialContract: { contractNumber: form.contractNumber, startDate: form.contractStart, endDate: form.contractEnd } } : {}),
      }),
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['vendors-contracts'] }); onClose(); },
    onError: (reason) => setError(errorText(reason, 'บันทึกผู้ให้บริการไม่สำเร็จ')),
  });

  return <Card data-testid="vendor-form"><CardHeader className="flex items-center justify-between"><span>{vendor ? `แก้ไข ${vendor.name}` : 'เพิ่มผู้ให้บริการ'}</span><button type="button" aria-label="ปิด" onClick={onClose}><X className="h-4 w-4" /></button></CardHeader><CardBody>
    <form className="grid gap-3 sm:grid-cols-4" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
      <label className="text-xs font-semibold sm:col-span-2">ชื่อผู้ให้บริการ<input required maxLength={200} data-testid="vendor-name" value={form.name} onChange={(e) => set('name', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">ประเภทบริการ<select value={form.serviceType} onChange={(e) => set('serviceType', e.target.value)} className={fieldClass}>{VENDOR_SERVICE_TYPES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-xs font-semibold">ผู้รับผิดชอบ<select value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)} className={fieldClass}><option value="">— ผู้บันทึก —</option>{references.owners.map((item) => <option key={item.id} value={item.id}>{profileName(item)}</option>)}</select></label>
      <label className="text-xs font-semibold">ผู้ติดต่อ<input maxLength={120} value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">เบอร์โทร<input maxLength={60} value={form.phone} onChange={(e) => set('phone', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">อีเมล<input type="email" maxLength={160} value={form.email} onChange={(e) => set('email', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">ช่องทางติดต่ออื่น<input maxLength={300} value={form.contactInfo} onChange={(e) => set('contactInfo', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-4">ขอบเขตบริการ<textarea maxLength={1000} rows={2} value={form.serviceScope} onChange={(e) => set('serviceScope', e.target.value)} className={fieldClass} /></label>
      {!vendor && <><div className="sm:col-span-4 mt-1 border-t pt-3 text-sm font-bold">สัญญาเริ่มต้น (ไม่บังคับ)</div>
        <label className="text-xs font-semibold sm:col-span-2">เลขที่สัญญา<input maxLength={100} data-testid="vendor-initial-contract" value={form.contractNumber} onChange={(e) => set('contractNumber', e.target.value)} className={fieldClass} /></label>
        <label className="text-xs font-semibold">วันเริ่ม<input type="date" value={form.contractStart} onChange={(e) => set('contractStart', e.target.value)} className={fieldClass} /></label>
        <label className="text-xs font-semibold">วันสิ้นสุด<input type="date" value={form.contractEnd} onChange={(e) => set('contractEnd', e.target.value)} className={fieldClass} /></label></>}
      <label className="text-xs font-semibold sm:col-span-4">หมายเหตุ<textarea maxLength={1000} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={fieldClass} /></label>
      {error && <p className="text-sm text-red-600 sm:col-span-4">{error}</p>}
      <div className="sm:col-span-4"><Button type="submit" size="sm" isLoading={mutation.isPending} data-testid="vendor-submit">บันทึกผู้ให้บริการ</Button></div>
    </form>
  </CardBody></Card>;
}

function ContractForm({ contract, references, onClose }: { contract?: Contract; references: ContractReferences; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    contractNumber: contract?.contract_number ?? '', name: contract?.name ?? '', vendorId: contract?.vendor_id ?? '',
    contractType: contract?.contract_type ?? 'Other', startDate: contract?.start_date ?? '', endDate: contract?.end_date ?? '',
    contractValue: contract?.contract_value?.toString() ?? '', currency: contract?.currency ?? 'THB',
    ownerId: contract?.owner_id ?? '', renewalNoticeDays: contract?.renewal_notice_days?.toString() ?? '30',
    status: contract?.status ?? 'Draft', serviceScope: contract?.service_scope ?? '', keyTerms: contract?.key_terms ?? '', notes: contract?.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const mutation = useMutation({
    mutationFn: () => apiFetch<Contract>(contract ? `/api/v1/contracts/${contract.id}` : '/api/v1/contracts', {
      method: contract ? 'PATCH' : 'POST',
      body: JSON.stringify({ ...form, ownerId: form.ownerId || null, contractValue: form.contractValue ? Number(form.contractValue) : undefined, renewalNoticeDays: Number(form.renewalNoticeDays) }),
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['vendors-contracts'] }); onClose(); },
    onError: (reason) => setError(errorText(reason, 'บันทึกสัญญาไม่สำเร็จ')),
  });

  return <Card data-testid="contract-form"><CardHeader className="flex items-center justify-between"><span>{contract ? `แก้ไข ${contract.contract_number}` : 'เพิ่มสัญญา'}</span><button type="button" aria-label="ปิด" onClick={onClose}><X className="h-4 w-4" /></button></CardHeader><CardBody>
    <form className="grid gap-3 sm:grid-cols-4" onSubmit={(event) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
      <label className="text-xs font-semibold">เลขที่สัญญา<input required maxLength={100} data-testid="contract-number" value={form.contractNumber} onChange={(e) => set('contractNumber', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-2">ชื่อสัญญา<input required maxLength={200} data-testid="contract-name" value={form.name} onChange={(e) => set('name', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">ประเภท<select value={form.contractType} onChange={(e) => set('contractType', e.target.value)} className={fieldClass}>{CONTRACT_TYPES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-xs font-semibold sm:col-span-2">ผู้ให้บริการ<select required data-testid="contract-vendor" value={form.vendorId} onChange={(e) => set('vendorId', e.target.value)} className={fieldClass}><option value="">— เลือกผู้ให้บริการ —</option>{references.vendors.map((item) => <option key={item.id} value={item.id}>{item.vendor_code} — {item.name}{item.status !== 'Active' ? ' (Inactive)' : ''}</option>)}</select></label>
      <label className="text-xs font-semibold">สถานะ<select value={form.status} onChange={(e) => set('status', e.target.value)} className={fieldClass}>{CONTRACT_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-xs font-semibold">ผู้รับผิดชอบ<select value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)} className={fieldClass}><option value="">— ผู้บันทึก —</option>{references.owners.map((item) => <option key={item.id} value={item.id}>{profileName(item)}</option>)}</select></label>
      <label className="text-xs font-semibold">วันเริ่ม<input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">วันสิ้นสุด<input type="date" data-testid="contract-end-date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">แจ้งเตือนล่วงหน้า (วัน)<input type="number" min="0" max="3650" value={form.renewalNoticeDays} onChange={(e) => set('renewalNoticeDays', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">มูลค่าสัญญา<input type="number" min="0" step="0.01" value={form.contractValue} onChange={(e) => set('contractValue', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold">สกุลเงิน<input required pattern="[A-Z]{3}" maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-2">ขอบเขตสัญญา<textarea maxLength={1500} rows={3} value={form.serviceScope} onChange={(e) => set('serviceScope', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-2">เงื่อนไขสำคัญ<textarea maxLength={2000} rows={3} value={form.keyTerms} onChange={(e) => set('keyTerms', e.target.value)} className={fieldClass} /></label>
      <label className="text-xs font-semibold sm:col-span-4">หมายเหตุ<textarea maxLength={1000} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={fieldClass} /></label>
      {error && <p className="text-sm text-red-600 sm:col-span-4">{error}</p>}
      <div className="sm:col-span-4"><Button type="submit" size="sm" isLoading={mutation.isPending} data-testid="contract-submit">บันทึกสัญญา</Button></div>
    </form>
  </CardBody></Card>;
}

function VendorTable({ items, canManage, onEdit }: { items: Vendor[]; canManage: boolean; onEdit: (vendor: Vendor) => void }) {
  const queryClient = useQueryClient();
  const [assessing, setAssessing] = useState<Vendor | null>(null);
  const [result, setResult] = useState('');
  const [error, setError] = useState<string | null>(null);
  const statusMutation = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => apiFetch(`/api/v1/vendors/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['vendors-contracts'] }) });
  const assessMutation = useMutation({ mutationFn: () => apiFetch(`/api/v1/vendors/${assessing!.id}/assessment`, { method: 'POST', body: JSON.stringify({ result }) }), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['vendors-contracts'] }); setAssessing(null); setResult(''); }, onError: (reason) => setError(errorText(reason, 'บันทึกผลประเมินไม่สำเร็จ')) });

  return <>{assessing && <Card className="mb-3"><CardHeader className="flex items-center justify-between"><span>ประเมิน/ตรวจรับ: {assessing.name}</span><button type="button" onClick={() => setAssessing(null)} aria-label="ปิด"><X className="h-4 w-4" /></button></CardHeader><CardBody><textarea autoFocus rows={3} maxLength={2000} value={result} onChange={(e) => setResult(e.target.value)} className={`${fieldClass} mb-2`} />{error && <p className="mb-2 text-sm text-red-600">{error}</p>}<Button size="sm" disabled={!result.trim()} isLoading={assessMutation.isPending} onClick={() => assessMutation.mutate()}>บันทึกผลประเมิน</Button></CardBody></Card>}
    <div className="overflow-x-auto"><DataTable className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="p-2">ผู้ให้บริการ</th><th className="p-2">ผู้ติดต่อ</th><th className="p-2">สัญญา</th><th className="p-2">ผลประเมิน</th><th className="p-2">สถานะ</th>{canManage && <th className="p-2">จัดการ</th>}</tr></thead><tbody>{items.map((item) => <tr key={item.id} data-testid={`vendor-row-${item.id}`} className="border-t border-slate-100 align-top dark:border-slate-700"><td className="p-2"><p className="font-semibold">{item.name}</p><p className="font-mono text-xs text-slate-400">{item.vendor_code}</p><p className="text-xs text-slate-500">{item.service_type}</p></td><td className="p-2 text-slate-500"><p>{item.contact_person || '—'}</p><p className="text-xs">{item.phone || item.email || ''}</p></td><td className="p-2 text-slate-500">{item.contracts?.length ?? 0} ฉบับ</td><td className="max-w-xs p-2 text-slate-500"><p className="line-clamp-2">{item.assessment_result || '—'}</p>{item.assessment_date && <p className="text-xs text-slate-400">{formatThaiDate(item.assessment_date)}</p>}</td><td className="p-2"><Badge variant={vendorStatusTone[item.status]}>{item.status}</Badge></td>{canManage && <td className="p-2 text-right"><RowActions recordLabel={item.vendor_code ?? item.name} actions={[
          { kind: 'edit', onClick: () => onEdit(item) },
          { kind: 'custom', icon: ClipboardCheck, label: 'ประเมิน', onClick: () => { setAssessing(item); setResult(item.assessment_result ?? ''); } },
          item.status === 'Active'
            ? { kind: 'cancel', label: 'ปิดใช้', confirmDescription: 'ผู้ให้บริการรายนี้จะไม่ปรากฏให้เลือกในงานใหม่ สัญญาและประวัติที่บันทึกไว้ยังอยู่ครบ', onConfirm: () => statusMutation.mutate({ id: item.id, status: 'Inactive' }) }
            : { kind: 'custom', icon: RotateCcw, label: 'เปิดใช้', onClick: () => statusMutation.mutate({ id: item.id, status: 'Active' }) },
        ]} /></td>}</tr>)}</tbody></DataTable></div>
  </>;
}

function ContractTable({ items, canManage, onEdit }: { items: Contract[]; canManage: boolean; onEdit: (contract: Contract) => void }) {
  const queryClient = useQueryClient();
  const statusMutation = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => apiFetch(`/api/v1/contracts/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['vendors-contracts'] }) });
  return <div className="overflow-x-auto"><DataTable className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="p-2">สัญญา</th><th className="p-2">ผู้ให้บริการ</th><th className="p-2">ระยะเวลา</th><th className="p-2">มูลค่า</th><th className="p-2">สถานะ</th>{canManage && <th className="p-2">จัดการ</th>}</tr></thead><tbody>{items.map((item) => { const days = daysUntilDate(item.end_date); const state = effectiveContractState(item); return <tr key={item.id} data-testid={`contract-row-${item.id}`} className="border-t border-slate-100 align-top dark:border-slate-700"><td className="p-2"><p className="font-semibold">{item.name}</p><p className="font-mono text-xs text-primary-700 dark:text-primary-300">{item.contract_number}</p><p className="text-xs text-slate-500">{item.contract_type} · {profileName(item.owner)}</p></td><td className="p-2 text-slate-500">{item.vendor?.name ?? '—'}</td><td className="p-2 text-slate-500"><p>{item.start_date ? formatThaiDate(item.start_date) : '—'} – {item.end_date ? formatThaiDate(item.end_date) : 'ไม่กำหนด'}</p>{state === 'expiring' && <p className="text-xs font-semibold text-amber-600">เหลือ {days} วัน</p>}{state === 'expired' && <p className="text-xs font-semibold text-red-600">พ้นวันสิ้นสุดแล้ว</p>}</td><td className="p-2 text-slate-500">{item.contract_value === null ? '—' : `${new Intl.NumberFormat('th-TH').format(item.contract_value)} ${item.currency}`}</td><td className="p-2"><Badge variant={state === 'expired' ? 'danger' : state === 'expiring' ? 'warning' : contractStatusTone[item.status]}>{item.status}</Badge></td>{canManage && <td className="p-2 text-right"><RowActions recordLabel={item.contract_number} actions={[
          { kind: 'edit', onClick: () => onEdit(item) },
          { kind: 'node', node: <select aria-label={`สถานะ ${item.contract_number}`} disabled={statusMutation.isPending} value={item.status} onChange={(e) => statusMutation.mutate({ id: item.id, status: e.target.value })} className="min-h-8 rounded-lg border border-slate-300 px-2 text-xs dark:border-slate-600 dark:bg-slate-900">{CONTRACT_STATUSES.map((status) => <option key={status}>{status}</option>)}</select> },
        ]} /></td>}</tr>; })}</tbody></DataTable></div>;
}

export function VendorContractsPage() {
  const { hasPermission } = useAuth();
  const canVendorView = hasPermission('vendor.view');
  const canContractView = hasPermission('contract.view');
  const canVendorManage = hasPermission('vendor.manage');
  const canContractManage = hasPermission('contract.manage');
  const [tab, setTab] = useState<ActiveTab>(canVendorView ? 'vendors' : 'contracts');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | undefined>();
  const [editingContract, setEditingContract] = useState<Contract | undefined>();
  const debouncedSearch = useDebouncedValue(search);
  const queryClient = useQueryClient();

  const vendorsQuery = useQuery({ queryKey: ['vendors-contracts', 'vendors', debouncedSearch, status], enabled: canVendorView, queryFn: () => apiFetch<PaginatedResult<Vendor>>(`/api/v1/vendors?page=1&pageSize=100${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}${status ? `&status=${status}` : ''}`) });
  const contractsQuery = useQuery({ queryKey: ['vendors-contracts', 'contracts', debouncedSearch, status], enabled: canContractView, queryFn: () => apiFetch<PaginatedResult<Contract>>(`/api/v1/contracts?page=1&pageSize=100${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}${status ? `&status=${status}` : ''}`) });
  const vendorRefs = useQuery({ queryKey: ['vendors-contracts', 'vendor-references'], enabled: canVendorManage && tab === 'vendors' && showForm, queryFn: () => apiFetch<VendorReferences>('/api/v1/vendors/references') });
  const contractRefs = useQuery({ queryKey: ['vendors-contracts', 'contract-references'], enabled: canContractManage && tab === 'contracts' && showForm, queryFn: () => apiFetch<ContractReferences>('/api/v1/contracts/references') });
  const expiryMutation = useMutation({ mutationFn: () => apiFetch<{ updatedCount: number; notifiedCount: number }>('/api/v1/contracts/check-expiry', { method: 'POST', body: '{}' }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['vendors-contracts'] }) });

  const vendors = vendorsQuery.data?.items ?? [];
  const contracts = contractsQuery.data?.items ?? [];
  const contractStats = { expiring: contracts.filter((item) => effectiveContractState(item) === 'expiring').length, expired: contracts.filter((item) => effectiveContractState(item) === 'expired').length };
  const activeItems = tab === 'vendors' ? vendors : contracts;
  const loading = tab === 'vendors' ? vendorsQuery.isLoading : contractsQuery.isLoading;
  const canManage = tab === 'vendors' ? canVendorManage : canContractManage;
  const resetForm = () => { setShowForm(false); setEditingVendor(undefined); setEditingContract(undefined); };
  const switchTab = (next: ActiveTab) => { setTab(next); setSearch(''); setStatus(''); resetForm(); };

  return <div className="flex flex-col gap-4" data-testid="vendor-contracts-page">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h1 className="text-xl font-bold">Vendor / Contract</h1><p className="text-sm text-slate-500">ทะเบียนผู้ให้บริการ การประเมิน และติดตามอายุสัญญา</p></div><div className="flex gap-2">{canContractManage && <Button size="sm" variant="outline" isLoading={expiryMutation.isPending} onClick={() => expiryMutation.mutate()} data-testid="contract-check-expiry"><RefreshCw className="h-4 w-4" />ตรวจสัญญาหมดอายุ</Button>}{canManage && <Button size="sm" onClick={() => { setShowForm(true); setEditingVendor(undefined); setEditingContract(undefined); }} data-testid="vendor-contract-create-toggle"><Plus className="h-4 w-4" />{tab === 'vendors' ? 'เพิ่มผู้ให้บริการ' : 'เพิ่มสัญญา'}</Button>}</div></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><StatCard icon={<Building2 className="h-5 w-5" />} label="ผู้ให้บริการ" value={vendorsQuery.data?.pagination.totalItems ?? 0} tone="primary" /><StatCard icon={<FileText className="h-5 w-5" />} label="สัญญาทั้งหมด" value={contractsQuery.data?.pagination.totalItems ?? 0} tone="gray" /><StatCard icon={<CalendarClock className="h-5 w-5" />} label="ใกล้หมดใน 30 วัน" value={contractStats.expiring} tone={contractStats.expiring ? 'amber' : 'gray'} /><StatCard icon={<CalendarClock className="h-5 w-5" />} label="หมดอายุแล้ว" value={contractStats.expired} tone={contractStats.expired ? 'danger' : 'gray'} /></div>
    <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">{canVendorView && <button type="button" onClick={() => switchTab('vendors')} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${tab === 'vendors' ? 'bg-white text-primary-700 shadow-sm dark:bg-slate-700 dark:text-primary-300' : 'text-slate-500'}`}>ผู้ให้บริการ</button>}{canContractView && <button type="button" onClick={() => switchTab('contracts')} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${tab === 'contracts' ? 'bg-white text-primary-700 shadow-sm dark:bg-slate-700 dark:text-primary-300' : 'text-slate-500'}`}>สัญญา</button>}</div>
    {showForm && tab === 'vendors' && <FormModal title={editingVendor ? 'แก้ไขผู้ให้บริการ' : 'เพิ่มผู้ให้บริการ'} description="จัดการข้อมูลผู้ติดต่อและการประเมิน Vendor" size="xl" onClose={resetForm}>{vendorRefs.isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div> : vendorRefs.data && <VendorForm vendor={editingVendor} references={vendorRefs.data} onClose={resetForm} />}</FormModal>}
    {showForm && tab === 'contracts' && <FormModal title={editingContract ? 'แก้ไขสัญญา' : 'เพิ่มสัญญา'} description="จัดการคู่สัญญา ขอบเขต และวันหมดอายุ" size="xl" onClose={resetForm}>{contractRefs.isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div> : contractRefs.data && <ContractForm contract={editingContract} references={contractRefs.data} onClose={resetForm} />}</FormModal>}
    <Card><CardHeader className="flex flex-wrap items-center justify-between gap-2"><span>{tab === 'vendors' ? 'ทะเบียนผู้ให้บริการ' : 'ทะเบียนสัญญา'}</span><select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-normal dark:border-slate-600 dark:bg-slate-900"><option value="">ทุกสถานะ</option>{(tab === 'vendors' ? ['Active', 'Inactive'] : CONTRACT_STATUSES).map((item) => <option key={item}>{item}</option>)}</select></CardHeader><CardBody>
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === 'vendors' ? 'ค้นหารหัส ชื่อ ผู้ติดต่อ หรืออีเมล...' : 'ค้นหาเลขที่ ชื่อ หรือขอบเขตสัญญา...'} className={`${fieldClass} mb-3 max-w-md`} />
      {loading && <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin" />}
      {!loading && activeItems.length === 0 && <EmptyState icon={tab === 'vendors' ? <Building2 className="h-10 w-10" /> : <FileText className="h-10 w-10" />} title={tab === 'vendors' ? 'ยังไม่มีผู้ให้บริการ' : 'ยังไม่มีสัญญา'} />}
      {tab === 'vendors' && vendors.length > 0 && <VendorTable items={vendors} canManage={canVendorManage} onEdit={(item) => { setEditingVendor(item); setShowForm(true); }} />}
      {tab === 'contracts' && contracts.length > 0 && <ContractTable items={contracts} canManage={canContractManage} onEdit={(item) => { setEditingContract(item); setShowForm(true); }} />}
    </CardBody></Card>
  </div>;
}
