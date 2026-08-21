import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Boxes,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  UserRoundCog,
  UsersRound,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DataTable, TablePagination } from '../../components/table/DataTable';
import { BulkActionModal, BulkResultSummary, bulkFieldClass, type BulkResult } from '../../components/table/BulkAction';
import { ExportAllButton } from '../../components/table/ExportAllButton';
import { RowActions } from '../../components/table/RowActions';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { FormModal, Modal } from '../../components/ui/Modal';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { Department, Employee, PaginatedResult, Position } from '../../types/admin';
import {
  EMPLOYEE_ASSET_CATEGORIES,
  EMPLOYEE_ASSIGNMENT_STATUSES,
  type AssetOption,
  type EmployeeAssignment,
} from '../../types/assets';

const fieldClass = 'h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-primary-900/40';
const textareaClass = `${fieldClass} h-auto min-h-24 py-2`;

interface EmployeesOverview {
  total: number;
  active: number;
  employeesWithAssignments: number;
  assignmentTotal: number;
  pendingLifecycle: number;
  assignmentCounts: Record<string, number>;
}

const employeeSchema = z.object({
  employeeCode: z.string().trim().min(1, 'กรุณากรอกรหัสพนักงาน'),
  status: z.enum(['active', 'inactive']),
  prefixTh: z.string().trim().optional(),
  firstNameTh: z.string().trim().min(1, 'กรุณากรอกชื่อ'),
  lastNameTh: z.string().trim().min(1, 'กรุณากรอกนามสกุล'),
  nickname: z.string().trim().optional(),
  prefixEn: z.string().trim().optional(),
  firstNameEn: z.string().trim().optional(),
  lastNameEn: z.string().trim().optional(),
  departmentId: z.string().optional(),
  positionId: z.string().optional(),
  usernameAd: z.string().trim().optional(),
  upn: z.string().trim().optional(),
  email: z.string().trim().email('รูปแบบ Email ไม่ถูกต้อง').optional().or(z.literal('')),
  notes: z.string().trim().optional(),
});

type EmployeeFormValues = z.infer<typeof employeeSchema>;

function employeeName(employee: Employee): string {
  return [employee.prefix_th, employee.first_name_th, employee.last_name_th].filter(Boolean).join(' ');
}

function englishName(employee: Employee): string {
  return [employee.prefix_en, employee.first_name_en, employee.last_name_en].filter(Boolean).join(' ');
}

function Label({ htmlFor, required, children }: { htmlFor: string; required?: boolean; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-300">
      {children}{required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  );
}

function EmployeeEditor({ employee, departments, positions, onClose }: { employee?: Employee; departments: Department[]; positions: Position[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const formId = employee ? `employee-edit-${employee.id}` : 'employee-create';
  const { register, handleSubmit, formState: { errors } } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      employeeCode: employee?.employee_code ?? '',
      status: employee?.status ?? 'active',
      prefixTh: employee?.prefix_th ?? '',
      firstNameTh: employee?.first_name_th ?? '',
      lastNameTh: employee?.last_name_th ?? '',
      nickname: employee?.nickname ?? '',
      prefixEn: employee?.prefix_en ?? '',
      firstNameEn: employee?.first_name_en ?? '',
      lastNameEn: employee?.last_name_en ?? '',
      departmentId: employee?.department_id ?? '',
      positionId: employee?.position_id ?? '',
      usernameAd: employee?.username_ad ?? '',
      upn: employee?.upn ?? '',
      email: employee?.email ?? '',
      notes: employee?.notes ?? '',
    },
  });
  const mutation = useMutation({
    mutationFn: (values: EmployeeFormValues) => apiFetch(employee ? `/api/v1/employees/${employee.id}` : '/api/v1/employees', {
      method: employee ? 'PATCH' : 'POST',
      body: JSON.stringify({
        ...values,
        departmentId: values.departmentId || undefined,
        positionId: values.positionId || undefined,
        email: values.email || undefined,
      }),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'employees'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'employees-overview'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'บันทึกข้อมูลพนักงานไม่สำเร็จ'),
  });

  return (
    <FormModal
      title={employee ? `แก้ไขพนักงาน · ${employeeName(employee)}` : 'เพิ่มพนักงาน'}
      size="xl"
      onClose={onClose}
      testId={employee ? 'employee-edit-dialog' : 'employee-create-dialog'}
      contentClassName="px-5 py-5"
      footer={<><Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button><Button type="submit" form={formId} isLoading={mutation.isPending}>{employee ? 'บันทึกการแก้ไข' : 'เพิ่มพนักงาน'}</Button></>}
    >
      <form id={formId} onSubmit={handleSubmit((values) => mutation.mutate(values))} className="grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-6" noValidate>
        <div className="md:col-span-2"><Label htmlFor={`${formId}-code`} required>รหัสพนักงาน</Label><input id={`${formId}-code`} data-testid="employee-code" className={fieldClass} {...register('employeeCode')} />{errors.employeeCode && <p className="mt-1 text-xs text-red-600">{errors.employeeCode.message}</p>}</div>
        <div className="md:col-span-2"><Label htmlFor={`${formId}-status`}>สถานะ</Label><select id={`${formId}-status`} className={fieldClass} {...register('status')}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        <div className="md:col-span-2"><Label htmlFor={`${formId}-prefix`}>คำนำหน้า</Label><input id={`${formId}-prefix`} className={fieldClass} {...register('prefixTh')} /></div>

        <div className="md:col-span-2"><Label htmlFor={`${formId}-first`} required>ชื่อ</Label><input id={`${formId}-first`} className={fieldClass} {...register('firstNameTh')} />{errors.firstNameTh && <p className="mt-1 text-xs text-red-600">{errors.firstNameTh.message}</p>}</div>
        <div className="md:col-span-2"><Label htmlFor={`${formId}-last`} required>นามสกุล</Label><input id={`${formId}-last`} className={fieldClass} {...register('lastNameTh')} />{errors.lastNameTh && <p className="mt-1 text-xs text-red-600">{errors.lastNameTh.message}</p>}</div>
        <div className="md:col-span-2"><Label htmlFor={`${formId}-nickname`}>ชื่อเล่น</Label><input id={`${formId}-nickname`} className={fieldClass} {...register('nickname')} /></div>

        <div className="md:col-span-2"><Label htmlFor={`${formId}-prefix-en`}>คำนำหน้า (อังกฤษ)</Label><input id={`${formId}-prefix-en`} className={fieldClass} {...register('prefixEn')} /></div>
        <div className="md:col-span-2"><Label htmlFor={`${formId}-first-en`}>Name</Label><input id={`${formId}-first-en`} className={fieldClass} {...register('firstNameEn')} /></div>
        <div className="md:col-span-2"><Label htmlFor={`${formId}-last-en`}>Lastname</Label><input id={`${formId}-last-en`} className={fieldClass} {...register('lastNameEn')} /></div>

        <div className="md:col-span-3"><Label htmlFor={`${formId}-position`}>ตำแหน่ง</Label><select id={`${formId}-position`} className={fieldClass} {...register('positionId')}><option value="">— ไม่ระบุ —</option>{positions.filter((item) => item.status === 'active' || item.id === employee?.position_id).map((item) => <option key={item.id} value={item.id}>{item.name_th}</option>)}</select></div>
        <div className="md:col-span-3"><Label htmlFor={`${formId}-department`}>Department</Label><select id={`${formId}-department`} className={fieldClass} {...register('departmentId')}><option value="">— ไม่ระบุ —</option>{departments.filter((item) => item.status === 'active' || item.id === employee?.department_id).map((item) => <option key={item.id} value={item.id}>{item.name_th}</option>)}</select></div>

        <div className="md:col-span-2"><Label htmlFor={`${formId}-ad`}>Username_AD</Label><input id={`${formId}-ad`} className={fieldClass} {...register('usernameAd')} /></div>
        <div className="md:col-span-2"><Label htmlFor={`${formId}-upn`}>UPN</Label><input id={`${formId}-upn`} className={fieldClass} {...register('upn')} /></div>
        <div className="md:col-span-2"><Label htmlFor={`${formId}-email`}>Email</Label><input id={`${formId}-email`} type="email" className={fieldClass} {...register('email')} />{errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}</div>
        <div className="md:col-span-6"><Label htmlFor={`${formId}-notes`}>Note</Label><textarea id={`${formId}-notes`} rows={3} className={textareaClass} {...register('notes')} /></div>
        {serverError && <p className="text-sm text-red-600 md:col-span-6" role="alert">{serverError}</p>}
      </form>
    </FormModal>
  );
}

type AssignmentFormState = {
  assetId: string; category: string; status: string; itemName: string; assetNumber: string; serialNumber: string;
  producer: string; model: string; macAddress: string; ipAddress: string; osSystem: string; phoneNumber: string;
  hardwareSpec: string; softwareName: string; softwareLicense: string; scanUser: string; scanFolder: string;
  assignedDate: string; returnedDate: string; notes: string;
};

const emptyAssignment: AssignmentFormState = {
  assetId: '', category: 'Computer', status: 'ครอบครอง', itemName: '', assetNumber: '', serialNumber: '', producer: '', model: '',
  macAddress: '', ipAddress: '', osSystem: '', phoneNumber: '', hardwareSpec: '', softwareName: '', softwareLicense: '',
  scanUser: '', scanFolder: '', assignedDate: '', returnedDate: '', notes: '',
};

function AssignmentModal({ employee, assets, canUseAssetRegister, onClose }: { employee: Employee; assets: AssetOption[]; canUseAssetRegister: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AssignmentFormState>(emptyAssignment);
  const [serverError, setServerError] = useState<string | null>(null);
  const set = (key: keyof AssignmentFormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const mutation = useMutation({
    mutationFn: () => apiFetch('/api/v1/employee-assignments', {
      method: 'POST',
      body: JSON.stringify({ employeeId: employee.id, ...Object.fromEntries(Object.entries(form).filter(([, value]) => value !== '')) }),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'employees-overview'] });
      void queryClient.invalidateQueries({ queryKey: ['employee-assignments'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เพิ่มรายการทรัพย์สินไม่สำเร็จ'),
  });
  const formId = `assignment-${employee.id}`;

  return (
    <FormModal title={`เพิ่มทรัพย์สิน · ${employeeName(employee)}`} size="xl" onClose={onClose} testId="employee-assignment-dialog" contentClassName="px-5 py-5" footer={<><Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button><Button type="submit" form={formId} isLoading={mutation.isPending}>เพิ่มรายการ</Button></>}>
      <form id={formId} onSubmit={(event) => { event.preventDefault(); if (!form.itemName.trim() && !form.assetId) { setServerError('กรุณาระบุชื่อรายการหรือเลือกจาก Asset Register'); return; } mutation.mutate(); }} className="grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-12">
        <div className="md:col-span-6"><Label htmlFor={`${formId}-asset`}>เชื่อมกับ Asset Register</Label><select id={`${formId}-asset`} disabled={!canUseAssetRegister} className={fieldClass} value={form.assetId} onChange={(event) => { const value = event.target.value; const asset = assets.find((item) => item.id === value); setForm((current) => ({ ...current, assetId: value, itemName: asset?.name ?? current.itemName, assetNumber: asset?.asset_code ?? current.assetNumber })); }}><option value="">— เลือก —</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_code} · {asset.name}</option>)}</select><p className="mt-1 text-xs text-slate-400">{canUseAssetRegister ? 'ไม่บังคับ; เลือกเมื่อรายการนี้มีอยู่ในทะเบียน IT Asset' : 'บัญชีนี้ไม่มีสิทธิ์อ่านทะเบียน IT Asset'}</p></div>
        <div className="md:col-span-3"><Label htmlFor={`${formId}-category`} required>Category</Label><select id={`${formId}-category`} className={fieldClass} value={form.category} onChange={(event) => set('category', event.target.value)}>{EMPLOYEE_ASSET_CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></div>
        <div className="md:col-span-3"><Label htmlFor={`${formId}-status`} required>สถานะ</Label><select id={`${formId}-status`} className={fieldClass} value={form.status} onChange={(event) => set('status', event.target.value)}>{EMPLOYEE_ASSIGNMENT_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></div>
        <div className="md:col-span-6"><Label htmlFor={`${formId}-name`} required>Name_Device / ชื่อรายการ</Label><input id={`${formId}-name`} className={fieldClass} value={form.itemName} onChange={(event) => set('itemName', event.target.value)} /></div>
        <div className="md:col-span-3"><Label htmlFor={`${formId}-asset-number`}>รหัส Asset</Label><input id={`${formId}-asset-number`} className={fieldClass} value={form.assetNumber} onChange={(event) => set('assetNumber', event.target.value)} /></div>
        <div className="md:col-span-3"><Label htmlFor={`${formId}-serial`}>เลขครุภัณฑ์ / S/N</Label><input id={`${formId}-serial`} className={fieldClass} value={form.serialNumber} onChange={(event) => set('serialNumber', event.target.value)} /></div>
        <div className="md:col-span-3"><Label htmlFor={`${formId}-producer`}>Producer / ผู้ผลิต</Label><input id={`${formId}-producer`} className={fieldClass} value={form.producer} onChange={(event) => set('producer', event.target.value)} /></div>
        <div className="md:col-span-3"><Label htmlFor={`${formId}-model`}>รุ่น</Label><input id={`${formId}-model`} className={fieldClass} value={form.model} onChange={(event) => set('model', event.target.value)} /></div>
        <div className="md:col-span-3"><Label htmlFor={`${formId}-mac`}>MAC Address</Label><input id={`${formId}-mac`} className={fieldClass} value={form.macAddress} onChange={(event) => set('macAddress', event.target.value)} /></div>
        <div className="md:col-span-3"><Label htmlFor={`${formId}-ip`}>IP Address - DHCP</Label><input id={`${formId}-ip`} className={fieldClass} value={form.ipAddress} onChange={(event) => set('ipAddress', event.target.value)} /></div>
        <div className="md:col-span-4"><Label htmlFor={`${formId}-os`}>OS System</Label><input id={`${formId}-os`} className={fieldClass} value={form.osSystem} onChange={(event) => set('osSystem', event.target.value)} /></div>
        <div className="md:col-span-4"><Label htmlFor={`${formId}-phone`}>เบอร์ติดต่อ</Label><input id={`${formId}-phone`} className={fieldClass} value={form.phoneNumber} onChange={(event) => set('phoneNumber', event.target.value)} /></div>
        <div className="md:col-span-4"><Label htmlFor={`${formId}-software`}>Software</Label><input id={`${formId}-software`} className={fieldClass} value={form.softwareName} onChange={(event) => set('softwareName', event.target.value)} /></div>
        <div className="md:col-span-6"><Label htmlFor={`${formId}-hardware`}>Hardware / Spec</Label><textarea id={`${formId}-hardware`} rows={3} className={textareaClass} value={form.hardwareSpec} onChange={(event) => set('hardwareSpec', event.target.value)} /></div>
        <div className="md:col-span-6"><Label htmlFor={`${formId}-license`}>License / สิทธิ์ใช้งาน</Label><input id={`${formId}-license`} className={fieldClass} value={form.softwareLicense} onChange={(event) => set('softwareLicense', event.target.value)} /></div>
        <div className="md:col-span-3"><Label htmlFor={`${formId}-scan-user`}>Scanner User</Label><input id={`${formId}-scan-user`} className={fieldClass} value={form.scanUser} onChange={(event) => set('scanUser', event.target.value)} /></div>
        <div className="md:col-span-5"><Label htmlFor={`${formId}-scan-folder`}>Scan Folder</Label><input id={`${formId}-scan-folder`} className={fieldClass} value={form.scanFolder} onChange={(event) => set('scanFolder', event.target.value)} /></div>
        <div className="md:col-span-2"><Label htmlFor={`${formId}-assigned-date`}>วันที่รับมอบ</Label><input id={`${formId}-assigned-date`} type="date" className={fieldClass} value={form.assignedDate} onChange={(event) => set('assignedDate', event.target.value)} /></div>
        <div className="md:col-span-2"><Label htmlFor={`${formId}-returned-date`}>วันที่คืน</Label><input id={`${formId}-returned-date`} type="date" className={fieldClass} value={form.returnedDate} onChange={(event) => set('returnedDate', event.target.value)} /></div>
        <div className="md:col-span-12"><Label htmlFor={`${formId}-notes`}>Note</Label><textarea id={`${formId}-notes`} rows={3} className={textareaClass} value={form.notes} onChange={(event) => set('notes', event.target.value)} /></div>
        {serverError && <p className="text-sm text-red-600 md:col-span-12" role="alert">{serverError}</p>}
      </form>
    </FormModal>
  );
}

function LifecycleModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [eventType, setEventType] = useState<'JOINER' | 'MOVER' | 'LEAVER'>('MOVER');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [newDepartment, setNewDepartment] = useState('');
  const [newPosition, setNewPosition] = useState('');
  const [reason, setReason] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const formId = `lifecycle-${employee.id}`;
  const mutation = useMutation({
    mutationFn: () => apiFetch('/api/v1/governance/operations/employee-lifecycle', { method: 'POST', body: JSON.stringify({ employeeId: employee.id, eventType, effectiveDate, newDepartment: newDepartment || undefined, newPosition: newPosition || undefined, reason }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'employees-overview'] }); onClose(); },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'เริ่ม Workflow ไม่สำเร็จ'),
  });
  return (
    <FormModal title={`เริ่ม Joiner / Mover / Leaver · ${employeeName(employee)}`} size="md" onClose={onClose} testId="employee-lifecycle-dialog" contentClassName="px-5 py-5" footer={<><Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button><Button type="submit" form={formId} isLoading={mutation.isPending}>เริ่ม Workflow</Button></>}>
      <form id={formId} onSubmit={(event) => { event.preventDefault(); if (!effectiveDate || !reason.trim()) { setServerError('กรุณาระบุวันที่มีผลและเหตุผล'); return; } mutation.mutate(); }} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><Label htmlFor={`${formId}-type`} required>เหตุการณ์</Label><select id={`${formId}-type`} className={fieldClass} value={eventType} onChange={(event) => setEventType(event.target.value as typeof eventType)}><option value="JOINER">JOINER · เริ่มงาน</option><option value="MOVER">MOVER · ย้ายหน่วยงาน/เปลี่ยนตำแหน่ง</option><option value="LEAVER">LEAVER · พ้นสภาพ</option></select></div>
        <div><Label htmlFor={`${formId}-date`} required>วันที่มีผล</Label><input id={`${formId}-date`} type="date" className={fieldClass} value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></div>
        {eventType === 'MOVER' && <><div><Label htmlFor={`${formId}-department`}>Department ใหม่</Label><input id={`${formId}-department`} className={fieldClass} value={newDepartment} onChange={(event) => setNewDepartment(event.target.value)} /></div><div><Label htmlFor={`${formId}-position`}>ตำแหน่งใหม่</Label><input id={`${formId}-position`} className={fieldClass} value={newPosition} onChange={(event) => setNewPosition(event.target.value)} /></div></>}
        <div className="sm:col-span-2"><Label htmlFor={`${formId}-reason`} required>เหตุผล/หมายเหตุ</Label><textarea id={`${formId}-reason`} rows={4} className={textareaClass} value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        {eventType === 'LEAVER' && <p className="text-xs text-slate-500 sm:col-span-2">LEAVER จะสร้าง checklist สำหรับระงับบัญชี สิทธิ์ และคืนทรัพย์สิน โดยยังไม่ระงับข้อมูลพนักงานทันที</p>}
        {serverError && <p className="text-sm text-red-600 sm:col-span-2" role="alert">{serverError}</p>}
      </form>
    </FormModal>
  );
}

function EmployeeDetailModal({ employee, departments, positions, onClose }: { employee: Employee; departments: Department[]; positions: Position[]; onClose: () => void }) {
  const assignmentsQuery = useQuery({ queryKey: ['employee-assignments', employee.id], queryFn: () => apiFetch<PaginatedResult<EmployeeAssignment>>(`/api/v1/employee-assignments?page=1&pageSize=100&employeeId=${employee.id}`) });
  const department = departments.find((item) => item.id === employee.department_id)?.name_th ?? '—';
  const position = positions.find((item) => item.id === employee.position_id)?.name_th ?? '—';
  return (
    <Modal title={`ข้อมูลพนักงาน · ${employeeName(employee)}`} size="lg" onClose={onClose} testId="employee-detail-dialog" contentClassName="px-5 py-5">
      <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        {[['รหัสพนักงาน', employee.employee_code], ['สถานะ', employee.status === 'active' ? 'Active' : 'Inactive'], ['Department', department], ['ตำแหน่ง', position], ['ชื่อภาษาอังกฤษ', englishName(employee) || '—'], ['Username_AD', employee.username_ad || '—'], ['UPN', employee.upn || '—'], ['Email', employee.email || '—']].map(([label, value]) => <div key={label}><p className="text-xs font-semibold text-slate-400">{label}</p><p className="mt-1 font-medium text-slate-700 dark:text-slate-200">{value}</p></div>)}
      </div>
      <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700"><h3 className="mb-3 font-bold text-slate-800 dark:text-slate-100">ทรัพย์สินและสิทธิ์ใช้งาน</h3>{assignmentsQuery.isLoading && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}{assignmentsQuery.data?.items.length === 0 && <p className="text-sm text-slate-400">ยังไม่มีรายการ</p>}{assignmentsQuery.data?.items.map((item) => <div key={item.id} className="mb-2 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"><div><p className="font-semibold text-slate-700 dark:text-slate-200">{item.item_name}</p><p className="text-xs text-slate-400">{item.category} · {item.asset?.asset_code ?? item.asset_number ?? 'ไม่มีรหัส Asset'}</p></div><Badge variant={item.status === 'ครอบครอง' ? 'success' : item.status === 'ส่งซ่อม' ? 'warning' : 'secondary'}>{item.status}</Badge></div>)}</div>
    </Modal>
  );
}

type EmployeeBulkResult = BulkResult<{ id: string; employeeCode: string; status: string }>;

/**
 * แผงดำเนินการกับพนักงานที่เลือกไว้หลายคน — ย้ายแผนก หรือเปลี่ยนสถานะ active/inactive
 *
 * holdersSelected เป็นการ "เตือน" ไม่ใช่ "ห้าม" — ฝั่ง api ไม่ได้ตั้งกฎนี้ไว้กับการแก้ทีละคน
 * การเพิ่มกฎเฉพาะเส้นทางทีละชุดจะทำให้สองเส้นทางให้ผลไม่ตรงกัน ซึ่งแย่กว่าการเตือนแล้วให้คนตัดสินใจ
 */
function BulkEmployeePanel({
  ids,
  departments,
  holdersSelected,
  onClose,
  onDone,
}: {
  ids: string[];
  departments: Department[];
  holdersSelected: number;
  onClose: () => void;
  onDone: (result: EmployeeBulkResult) => void;
}) {
  const [action, setAction] = useState<'status' | 'department'>('status');
  const [status, setStatus] = useState<'active' | 'inactive'>('inactive');
  const [departmentId, setDepartmentId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiFetch<EmployeeBulkResult>('/api/v1/employees/bulk', {
      method: 'PATCH',
      body: JSON.stringify(action === 'status' ? { ids, status } : { ids, departmentId }),
    }),
    onSuccess: onDone,
    onError: (mutationError) => setError(mutationError instanceof ApiError ? mutationError.message : 'ดำเนินการไม่สำเร็จ'),
  });

  return (
    <BulkActionModal
      count={ids.length}
      itemLabel="คน"
      isPending={mutation.isPending}
      error={error}
      onClose={onClose}
      onSubmit={() => {
        if (action === 'department' && !departmentId) {
          setError('กรุณาเลือก Department ปลายทาง');
          return;
        }
        setError(null);
        mutation.mutate();
      }}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {([['status', 'เปลี่ยนสถานะ'], ['department', 'ย้าย Department']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setAction(value)}
              className={`h-9 rounded-lg px-3 text-sm font-semibold ${action === value ? 'bg-blue-600 text-white' : 'border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {action === 'status' ? (
          <label className="block text-sm">
            <span className="font-semibold text-slate-700 dark:text-slate-200">สถานะใหม่</span>
            <select aria-label="สถานะใหม่" value={status} onChange={(event) => setStatus(event.target.value as 'active' | 'inactive')} className={bulkFieldClass}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        ) : (
          <label className="block text-sm">
            <span className="font-semibold text-slate-700 dark:text-slate-200">Department ปลายทาง</span>
            <select aria-label="Department ปลายทาง" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className={bulkFieldClass}>
              <option value="">เลือก Department</option>
              {departments.map((department) => <option key={department.id} value={department.id}>{department.name_th}</option>)}
            </select>
          </label>
        )}

        {action === 'status' && status === 'inactive' && holdersSelected > 0 && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200" role="alert">
            {holdersSelected.toLocaleString('th-TH')} คนที่เลือกไว้ยังมีทรัพย์สินครอบครองอยู่ — ปิดสถานะแล้วรายการครอบครองจะยังค้างในทะเบียน ควรรับคืนของก่อน
          </p>
        )}
      </div>
    </BulkActionModal>
  );
}

export function EmployeesPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [ownership, setOwnership] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showCreate, setShowCreate] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);
  const [assetEmployee, setAssetEmployee] = useState<Employee | null>(null);
  const [lifecycleEmployee, setLifecycleEmployee] = useState<Employee | null>(null);
  // รายการที่เลือกอยู่นอก URL เพราะเป็นสิ่งที่ทำแล้วจบ ไม่ใช่สถานะที่ควรแชร์ผ่านลิงก์
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkResult, setBulkResult] = useState<EmployeeBulkResult | null>(null);

  const queryString = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (debouncedSearch) queryString.set('search', debouncedSearch);
  if (status) queryString.set('status', status);
  if (departmentId) queryString.set('departmentId', departmentId);
  if (ownership) queryString.set('ownership', ownership);

  const employeesQuery = useQuery({ queryKey: ['admin', 'employees', page, pageSize, debouncedSearch, status, departmentId, ownership], queryFn: () => apiFetch<PaginatedResult<Employee>>(`/api/v1/employees?${queryString.toString()}`) });
  const overviewQuery = useQuery({ queryKey: ['admin', 'employees-overview'], queryFn: () => apiFetch<EmployeesOverview>('/api/v1/employees/overview') });
  const departmentsQuery = useQuery({ queryKey: ['admin', 'departments'], queryFn: () => apiFetch<Department[]>('/api/v1/departments') });
  const positionsQuery = useQuery({ queryKey: ['admin', 'positions'], queryFn: () => apiFetch<Position[]>('/api/v1/positions') });
  const canViewAssets = hasPermission('asset.view');
  const assetsQuery = useQuery({ queryKey: ['assets', 'options'], queryFn: () => apiFetch<AssetOption[]>('/api/v1/assets/options'), enabled: canViewAssets });
  const departments = departmentsQuery.data ?? [];
  const positions = positionsQuery.data ?? [];
  const rows = employeesQuery.data?.items ?? [];
  const overview = overviewQuery.data;

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: 'active' | 'inactive' }) => apiFetch(`/api/v1/employees/${id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'employees'] }); void queryClient.invalidateQueries({ queryKey: ['admin', 'employees-overview'] }); },
  });

  const canManageEmployee = hasPermission('employee.manage');
  // นับจาก assignmentCounts ของทั้งระบบ ไม่ใช่แค่หน้าปัจจุบัน เพราะรายการที่เลือกข้ามหน้าได้
  const holdersSelected = selectedIds.filter((id) => (overview?.assignmentCounts[id] ?? 0) > 0).length;

  const resetFilters = () => { setSearch(''); setStatus(''); setDepartmentId(''); setOwnership(''); setPage(1); };
  const refresh = () => { void employeesQuery.refetch(); void overviewQuery.refetch(); };

  return (
    <div className="flex flex-col gap-4" data-testid="employees-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">รายชื่อพนักงานและทรัพย์สินที่ครอบครอง</h1><p className="text-sm text-slate-500 dark:text-slate-400">ทะเบียนพนักงาน อุปกรณ์ Software และสิทธิ์ใช้งานที่อยู่กับแต่ละคน</p></div>
        <RequirePermission permission="employee.manage"><Button size="sm" onClick={() => setShowCreate(true)} data-testid="employee-create-toggle"><Plus className="h-4 w-4" aria-hidden="true" />เพิ่มพนักงาน</Button></RequirePermission>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={<UsersRound className="h-5 w-5" />} label="พนักงานทั้งหมด" value={overview?.total ?? 0} tone="primary" />
        <StatCard icon={<UserRoundCog className="h-5 w-5" />} label="Active" value={overview?.active ?? 0} tone="teal" />
        <StatCard icon={<Boxes className="h-5 w-5" />} label="มีทรัพย์สินครอบครอง" value={overview?.employeesWithAssignments ?? 0} tone="gray" />
        <StatCard icon={<GitBranch className="h-5 w-5" />} label="Lifecycle ค้าง" value={overview?.pendingLifecycle ?? 0} tone="teal" />
        <StatCard icon={<Box className="h-5 w-5" />} label="รายการที่ครอบครอง" value={overview?.assignmentTotal ?? 0} tone="gray" />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"><span className="inline-flex items-center gap-2"><GitBranch className="h-4 w-4 text-primary-600" aria-hidden="true" />ข้อมูลจากโมดูลนี้จะรวมรายการใน Employee Assignments, เจ้าของใน Asset Register และผู้ใช้ใน Software Licenses ไว้ในหน้ารายคน</span></div>

      <Card>
        <CardBody>
          <div className="mb-3 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3 xl:flex-row xl:items-center xl:justify-between dark:border-slate-700 dark:bg-slate-900/40">
            <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row">
              <label className="relative min-w-0 flex-1 md:max-w-xs"><span className="sr-only">ค้นหาพนักงาน</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" /><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="ค้นหาในรายการ..." className={`${fieldClass} pl-9`} /></label>
              <select aria-label="กรองสถานะ" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className={`${fieldClass} md:max-w-40`}><option value="">สถานะ: ทั้งหมด</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
              <select aria-label="กรอง Department" value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setPage(1); }} className={`${fieldClass} md:max-w-52`}><option value="">Department: ทั้งหมด</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name_th}</option>)}</select>
              <select aria-label="กรองการครอบครอง" value={ownership} onChange={(event) => { setOwnership(event.target.value); setPage(1); }} className={`${fieldClass} md:max-w-48`}><option value="">การครอบครอง: ทั้งหมด</option><option value="with">มีรายการครอบครอง</option><option value="without">ไม่มีรายการครอบครอง</option></select>
            </div>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={refresh}><RefreshCw className="h-4 w-4" aria-hidden="true" />รีเฟรช</Button><ExportAllButton disabled={!rows.length} url={`/api/v1/employees/export?${queryString.toString()}`} />{(search || status || departmentId || ownership) && <Button size="sm" variant="ghost" onClick={resetFilters}>ล้างตัวกรอง</Button>}<span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-500 dark:border-slate-600 dark:bg-slate-800">{employeesQuery.data?.pagination.totalItems ?? 0} รายการ</span></div>
          </div>

          {employeesQuery.isLoading && <div className="flex justify-center py-12" role="status"><Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" /></div>}
          {employeesQuery.data && rows.length === 0 && <EmptyState icon={<UsersRound className="h-10 w-10" aria-hidden="true" />} title="ไม่พบพนักงาน" description="ลองเปลี่ยนคำค้นหาหรือตัวกรอง" />}
          {rows.length > 0 && <DataTable
            toolbar={false}
            pagination={false}
            itemLabel="คน"
            selectable={canManageEmployee}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            selectionActions={<Button type="button" size="sm" onClick={() => setShowBulk(true)}>ดำเนินการกับที่เลือก</Button>}
            className="min-w-[1180px] text-xs"
            containerClassName="rounded-lg"
          >
            <thead><tr><th>ลำดับ</th><th>รหัสพนักงาน</th><th>ชื่อพนักงาน</th><th>ตำแหน่ง</th><th>Department</th><th>บัญชีผู้ใช้งาน</th><th>ทรัพย์สินที่ครอบครอง</th><th>จำนวน</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
            <tbody>{rows.map((employee, index) => {
              const count = overview?.assignmentCounts[employee.id] ?? 0;
              const department = departments.find((item) => item.id === employee.department_id)?.name_th ?? '—';
              const position = positions.find((item) => item.id === employee.position_id)?.name_th ?? '—';
              return <tr key={employee.id} data-row-id={employee.id}><td className="text-slate-400">{(page - 1) * pageSize + index + 1}</td><td className="font-mono font-semibold text-slate-600 dark:text-slate-300">{employee.employee_code}</td><td><p className="font-bold text-slate-700 dark:text-slate-100">{employeeName(employee)}</p>{employee.nickname && <p className="text-slate-400">ชื่อเล่น: {employee.nickname}</p>}{englishName(employee) && <p className="text-slate-400">{englishName(employee)}</p>}</td><td className="max-w-56 text-slate-600 dark:text-slate-300">{position}</td><td className="max-w-48 text-slate-600 dark:text-slate-300">{department}</td><td><p className="font-mono text-[11px] text-slate-500">AD: {employee.username_ad || '—'}</p><p className="max-w-44 break-all text-[11px] text-slate-400">{employee.upn || employee.email || '—'}</p></td><td className={count ? 'font-semibold text-slate-700 dark:text-slate-200' : 'text-slate-400'}>{count ? `${count} รายการ` : 'ยังไม่มีรายการ'}</td><td><span className="inline-flex min-w-7 justify-center rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-500 dark:bg-slate-700">{count}</span></td><td><Badge variant={employee.status === 'active' ? 'success' : 'secondary'}>{employee.status === 'active' ? 'Active' : 'Inactive'}</Badge></td><td className="text-right"><RowActions
                    recordLabel={employeeName(employee)}
                    actions={[
                      { kind: 'view', onClick: () => setViewingEmployee(employee) },
                      { kind: 'edit', onClick: () => setEditingEmployee(employee) },
                      { kind: 'custom', icon: Box, label: 'เพิ่มทรัพย์สิน', onClick: () => setAssetEmployee(employee) },
                      { kind: 'custom', icon: GitBranch, label: 'Lifecycle', permission: 'operations.manage', onClick: () => setLifecycleEmployee(employee) },
                      {
                        kind: 'cancel',
                        label: employee.status === 'active' ? 'ระงับ' : 'เปิดใช้งาน',
                        confirmDescription: employee.status === 'active'
                          ? 'พนักงานคนนี้จะถูกระงับ ประวัติการถือครองทรัพย์สินและงานที่เคยแจ้งยังอยู่ครบ'
                          : 'พนักงานคนนี้จะกลับมาใช้งานระบบได้ตามเดิม',
                        onConfirm: () => toggleStatusMutation.mutate({ id: employee.id, nextStatus: employee.status === 'active' ? 'inactive' : 'active' }),
                      },
                    ]}
                  /></td></tr>;
            })}</tbody>
          </DataTable>}
          {employeesQuery.data && <TablePagination page={employeesQuery.data.pagination.page} pageSize={pageSize} totalItems={employeesQuery.data.pagination.totalItems} totalPages={employeesQuery.data.pagination.totalPages} onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />}
        </CardBody>
      </Card>

      {bulkResult && <BulkResultSummary result={bulkResult} itemLabel="คน" onDismiss={() => setBulkResult(null)} />}

      {showBulk && (
        <BulkEmployeePanel
          ids={selectedIds}
          departments={departments}
          holdersSelected={holdersSelected}
          onClose={() => setShowBulk(false)}
          onDone={(result) => {
            setShowBulk(false);
            setBulkResult(result);
            // เหลือเฉพาะคนที่ทำไม่สำเร็จไว้ให้เลือกต่อ ผู้ใช้จะได้ลองแก้เฉพาะที่เหลือ
            setSelectedIds(result.failed.map((item) => item.id));
            void queryClient.invalidateQueries({ queryKey: ['admin', 'employees'] });
            void queryClient.invalidateQueries({ queryKey: ['admin', 'employees-overview'] });
          }}
        />
      )}

      {showCreate && <EmployeeEditor departments={departments} positions={positions} onClose={() => setShowCreate(false)} />}
      {editingEmployee && <EmployeeEditor employee={editingEmployee} departments={departments} positions={positions} onClose={() => setEditingEmployee(null)} />}
      {viewingEmployee && <EmployeeDetailModal employee={viewingEmployee} departments={departments} positions={positions} onClose={() => setViewingEmployee(null)} />}
      {assetEmployee && <AssignmentModal employee={assetEmployee} assets={assetsQuery.data ?? []} canUseAssetRegister={canViewAssets} onClose={() => setAssetEmployee(null)} />}
      {lifecycleEmployee && <LifecycleModal employee={lifecycleEmployee} onClose={() => setLifecycleEmployee(null)} />}
    </div>
  );
}
