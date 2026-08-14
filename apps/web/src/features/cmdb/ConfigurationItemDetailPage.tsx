import { DataTable } from '../../components/table/DataTable';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { EmployeeOption } from '../../types/admin';
import type { AssetOption } from '../../types/assets';
import type { CiNodeOption, ConfigurationItemDetail } from '../../types/cmdb';
import type { ContractOption, ContractVendorRef } from '../../types/vendorsContracts';
import { formatThaiDate } from '../../utils/date';
import {
  CI_CRITICALITIES,
  CI_DATA_CLASSIFICATIONS,
  CI_ENVIRONMENTS,
  CI_NODE_TYPES_ENABLED,
  CI_STATUSES,
  CI_TYPES,
  RELATIONSHIP_DIRECTIONS,
  RELATIONSHIP_IMPACT_LEVELS,
  RELATIONSHIP_TYPES_ENABLED,
  ciStatusTone,
  criticalityTone,
  employeeName,
  relationshipStatusTone,
} from './cmdbDisplay';

function useCiMutation(id: string, path = '') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch(`/api/v1/cmdb/items/${id}${path}`, { method: path ? 'POST' : 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cmdb', 'item', id] });
      void queryClient.invalidateQueries({ queryKey: ['cmdb', 'items'] });
    },
  });
}

const editSchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อ CI'),
  ciType: z.enum(CI_TYPES),
  environment: z.enum(CI_ENVIRONMENTS),
  businessService: z.string().trim().optional(),
  ownerEmployeeId: z.string().min(1, 'กรุณาเลือกเจ้าของ CI'),
  administratorEmployeeId: z.string().min(1, 'กรุณาเลือกผู้ดูแล CI'),
  criticality: z.enum(CI_CRITICALITIES),
  ipAddress: z.string().trim().optional(),
  url: z.string().trim().optional(),
  version: z.string().trim().optional(),
  vendorId: z.string().optional(),
  contractId: z.string().optional(),
  assetId: z.string().optional(),
  cloudRef: z.string().trim().optional(),
  dataClassification: z.enum(CI_DATA_CLASSIFICATIONS),
  rpoHours: z.coerce.number().nonnegative().optional().or(z.literal('')),
  rtoHours: z.coerce.number().nonnegative().optional().or(z.literal('')),
  backupRequired: z.boolean().optional(),
  backupReference: z.string().trim().optional(),
  location: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});
type EditForm = z.infer<typeof editSchema>;

function EditCiForm({ detail, employees, assetOptions, vendorOptions, contractOptions, onClose }: { detail: ConfigurationItemDetail; employees: EmployeeOption[]; assetOptions: AssetOption[]; vendorOptions: ContractVendorRef[]; contractOptions: ContractOption[]; onClose: () => void }) {
  const ci = detail.ci;
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: ci.name,
      ciType: ci.ci_type,
      environment: ci.environment,
      businessService: ci.business_service ?? '',
      ownerEmployeeId: ci.owner_employee_id ?? '',
      administratorEmployeeId: ci.administrator_employee_id ?? '',
      criticality: ci.criticality,
      ipAddress: ci.ip_address ?? '',
      url: ci.url ?? '',
      version: ci.version ?? '',
      vendorId: ci.vendor_id ?? '',
      contractId: ci.contract_id ?? '',
      assetId: ci.asset_id ?? '',
      cloudRef: ci.cloud_ref ?? '',
      dataClassification: ci.data_classification,
      rpoHours: ci.rpo_hours ?? '',
      rtoHours: ci.rto_hours ?? '',
      backupRequired: ci.backup_required,
      backupReference: ci.backup_reference ?? '',
      location: ci.location ?? '',
      notes: ci.notes ?? '',
    },
  });

  const mutation = useCiMutation(ci.id);

  const onSubmit = handleSubmit((values) =>
    mutation.mutate(
      {
        ...values,
        assetId: values.assetId || undefined,
        rpoHours: values.rpoHours === '' ? undefined : values.rpoHours,
        rtoHours: values.rtoHours === '' ? undefined : values.rtoHours,
      },
      { onSuccess: onClose, onError: (error) => setServerError(error instanceof ApiError ? error.message : 'แก้ไข CI ไม่สำเร็จ') },
    ),
  );

  return (
    <form onSubmit={onSubmit} data-testid="ci-edit-form" className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-900/40" noValidate>
      <div className="sm:col-span-2">
        <label htmlFor="ed-name" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ชื่อ CI</label>
        <input id="ed-name" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('name')} />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>
      <div>
        <label htmlFor="ed-type" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ประเภท</label>
        <select id="ed-type" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('ciType')}>
          {CI_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor="ed-env" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Environment</label>
        <select id="ed-env" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('environment')}>
          {CI_ENVIRONMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="ed-criticality" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Criticality</label>
        <select id="ed-criticality" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('criticality')}>
          {CI_CRITICALITIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="ed-classification" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Data Classification</label>
        <select id="ed-classification" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('dataClassification')}>
          {CI_DATA_CLASSIFICATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor="ed-owner" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">เจ้าของ (Owner)</label>
        <select id="ed-owner" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('ownerEmployeeId')}>
          <option value="">— เลือก —</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{employeeName(e)}</option>)}
        </select>
        {errors.ownerEmployeeId && <p className="mt-1 text-xs text-red-600">{errors.ownerEmployeeId.message}</p>}
      </div>
      <div>
        <label htmlFor="ed-admin" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้ดูแล (Administrator)</label>
        <select id="ed-admin" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('administratorEmployeeId')}>
          <option value="">— เลือก —</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{employeeName(e)}</option>)}
        </select>
        {errors.administratorEmployeeId && <p className="mt-1 text-xs text-red-600">{errors.administratorEmployeeId.message}</p>}
      </div>
      <div>
        <label htmlFor="ed-asset" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผูก Asset</label>
        <select id="ed-asset" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('assetId')}>
          <option value="">— ไม่ผูก —</option>
          {assetOptions.map((a) => <option key={a.id} value={a.id}>{a.asset_code} — {a.name}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor="ed-ip" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">IP Address</label>
        <input id="ed-ip" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('ipAddress')} />
      </div>
      <div>
        <label htmlFor="ed-url" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">URL</label>
        <input id="ed-url" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('url')} />
      </div>
      <div>
        <label htmlFor="ed-version" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Version</label>
        <input id="ed-version" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('version')} />
      </div>

      <div>
        <label htmlFor="ed-vendor" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Vendor</label>
        <select id="ed-vendor" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('vendorId')}><option value="">— ไม่ผูก —</option>{vendorOptions.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_code} — {vendor.name}</option>)}</select>
      </div>
      <div>
        <label htmlFor="ed-contract" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Contract Ref</label>
        <select id="ed-contract" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('contractId')}><option value="">— ไม่ผูก —</option>{contractOptions.map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_number} — {contract.name}</option>)}</select>
      </div>
      <div>
        <label htmlFor="ed-cloud" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Cloud Ref</label>
        <input id="ed-cloud" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('cloudRef')} />
      </div>

      <div>
        <label htmlFor="ed-rpo" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">RPO (ชั่วโมง)</label>
        <input id="ed-rpo" type="number" step="0.1" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('rpoHours')} />
      </div>
      <div>
        <label htmlFor="ed-rto" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">RTO (ชั่วโมง)</label>
        <input id="ed-rto" type="number" step="0.1" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('rtoHours')} />
      </div>
      <div className="flex items-end gap-2 pb-1.5">
        <input id="ed-backup-required" type="checkbox" className="h-4 w-4" {...register('backupRequired')} />
        <label htmlFor="ed-backup-required" className="text-xs font-semibold text-slate-600 dark:text-slate-300">ต้องสำรองข้อมูล (Backup Required)</label>
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="ed-backup-ref" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Backup Reference</label>
        <input id="ed-backup-ref" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('backupReference')} />
      </div>
      <div>
        <label htmlFor="ed-location" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สถานที่</label>
        <input id="ed-location" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('location')} />
      </div>

      <div className="sm:col-span-3">
        <label htmlFor="ed-notes" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หมายเหตุ</label>
        <textarea id="ed-notes" rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('notes')} />
      </div>

      {serverError && <p className="text-xs text-red-600 sm:col-span-3">{serverError}</p>}

      <div className="sm:col-span-3">
        <Button type="submit" size="sm" isLoading={isSubmitting} data-testid="ci-edit-save">บันทึก</Button>
      </div>
    </form>
  );
}

const createRelSchema = z
  .object({
    targetType: z.enum(CI_NODE_TYPES_ENABLED),
    targetId: z.string().min(1, 'กรุณาเลือกปลายทาง'),
    relationshipType: z.enum(RELATIONSHIP_TYPES_ENABLED),
    direction: z.enum(RELATIONSHIP_DIRECTIONS).optional(),
    impactLevel: z.enum(RELATIONSHIP_IMPACT_LEVELS).optional(),
    description: z.string().trim().optional(),
  });
type CreateRelForm = z.infer<typeof createRelSchema>;

function CreateRelationshipForm({ ciId, nodeOptions, onClose }: { ciId: string; nodeOptions: CiNodeOption[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateRelForm>({ resolver: zodResolver(createRelSchema), defaultValues: { targetType: 'CI' } });
  const targetType = watch('targetType');
  const targetOptions = nodeOptions.filter((n) => n.type === targetType && n.id !== ciId);

  const mutation = useMutation({
    mutationFn: (values: CreateRelForm) =>
      apiFetch('/api/v1/cmdb/relationships', {
        method: 'POST',
        body: JSON.stringify({ sourceType: 'CI', sourceId: ciId, ...values }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cmdb', 'item', ciId] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'สร้างความสัมพันธ์ไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      data-testid="ci-rel-create-form"
      className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-900/40"
      noValidate
    >
      <div className="flex items-center justify-between sm:col-span-3">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">เพิ่มความสัมพันธ์</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div>
        <label htmlFor="rel-target-type" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ประเภทปลายทาง</label>
        <select id="rel-target-type" data-testid="ci-rel-target-type" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('targetType')}>
          <option value="CI">CI</option>
          <option value="Asset">Asset</option>
          <option value="Incident">Incident</option>
          <option value="Change">Change</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="rel-target" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ปลายทาง</label>
        <select id="rel-target" data-testid="ci-rel-target" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('targetId')}>
          <option value="">— เลือก —</option>
          {targetOptions.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        {errors.targetId && <p className="mt-1 text-xs text-red-600">{errors.targetId.message}</p>}
      </div>

      <div>
        <label htmlFor="rel-type" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ความสัมพันธ์</label>
        <select id="rel-type" data-testid="ci-rel-type" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('relationshipType')}>
          {RELATIONSHIP_TYPES_ENABLED.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="rel-direction" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ทิศทาง</label>
        <select id="rel-direction" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('direction')}>
          {RELATIONSHIP_DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="rel-impact" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Impact Level</label>
        <select id="rel-impact" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('impactLevel')}>
          {RELATIONSHIP_IMPACT_LEVELS.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>

      <div className="sm:col-span-3">
        <label htmlFor="rel-desc" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">คำอธิบาย</label>
        <input id="rel-desc" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('description')} />
      </div>

      {serverError && <p className="text-xs text-red-600 sm:col-span-3">{serverError}</p>}

      <div className="sm:col-span-3">
        <Button type="submit" size="sm" isLoading={isSubmitting} data-testid="ci-rel-create-submit">บันทึก</Button>
      </div>
    </form>
  );
}

export function ConfigurationItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);
  const [showAddRel, setShowAddRel] = useState(false);
  const [statusValue, setStatusValue] = useState('');
  const [statusReason, setStatusReason] = useState('');

  const detailQuery = useQuery({
    queryKey: ['cmdb', 'item', id],
    queryFn: () => apiFetch<ConfigurationItemDetail>(`/api/v1/cmdb/items/${id}`),
    enabled: Boolean(id),
  });
  const employeesQuery = useQuery({ queryKey: ['employee-options'], queryFn: () => apiFetch<EmployeeOption[]>('/api/v1/employees/options') });
  const assetOptionsQuery = useQuery({ queryKey: ['assets', 'options'], queryFn: () => apiFetch<AssetOption[]>('/api/v1/assets/options') });
  const vendorOptionsQuery = useQuery({ queryKey: ['vendors-contracts', 'vendor-options'], queryFn: () => apiFetch<ContractVendorRef[]>('/api/v1/vendors/options'), enabled: showEdit });
  const contractOptionsQuery = useQuery({ queryKey: ['vendors-contracts', 'contract-options'], queryFn: () => apiFetch<ContractOption[]>('/api/v1/contracts/options'), enabled: showEdit });
  const nodeOptionsQuery = useQuery({ queryKey: ['cmdb', 'node-options'], queryFn: () => apiFetch<CiNodeOption[]>('/api/v1/cmdb/relationships/node-options') });

  const statusMutation = useCiMutation(id ?? '', '/status');
  const verifyMutation = useCiMutation(id ?? '', '/verify');

  const relVerifyMutation = useMutation({
    mutationFn: (relId: string) => apiFetch(`/api/v1/cmdb/relationships/${relId}/verify`, { method: 'POST', body: '{}' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['cmdb', 'item', id] }),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="flex justify-center py-16" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
      </div>
    );
  }
  if (!detailQuery.data) return null;

  const { ci, relationships } = detailQuery.data;

  return (
    <div className="flex flex-col gap-4" data-testid="ci-detail-page">
      <button type="button" onClick={() => navigate('/cmdb')} className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        กลับไป CMDB
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{ci.name}</h1>
          <p className="font-mono text-sm text-slate-500 dark:text-slate-400">{ci.ci_code}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={criticalityTone[ci.criticality]}>{ci.criticality}</Badge>
          <Badge variant={ciStatusTone[ci.status]}>{ci.status}</Badge>
          <RequirePermission permission="cmdb.manage">
            <Button size="sm" variant="outline" onClick={() => setShowEdit((v) => !v)} data-testid="ci-detail-edit-toggle">
              แก้ไข
            </Button>
          </RequirePermission>
        </div>
      </div>

      {showEdit && employeesQuery.data && assetOptionsQuery.data && vendorOptionsQuery.data && contractOptionsQuery.data && (
        <EditCiForm detail={detailQuery.data} employees={employeesQuery.data} assetOptions={assetOptionsQuery.data} vendorOptions={vendorOptionsQuery.data} contractOptions={contractOptionsQuery.data} onClose={() => setShowEdit(false)} />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>รายละเอียด CI</CardHeader>
          <CardBody className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <Info label="ประเภท" value={ci.ci_type} />
            <Info label="Environment" value={ci.environment} />
            <Info label="Business Service" value={ci.business_service ?? '—'} />
            <Info label="เจ้าของ" value={employeeName(ci.owner)} />
            <Info label="ผู้ดูแล" value={employeeName(ci.administrator)} />
            <Info label="Data Classification" value={ci.data_classification} />
            <Info label="IP Address" value={ci.ip_address ?? '—'} />
            <Info label="URL" value={ci.url ?? '—'} />
            <Info label="Version" value={ci.version ?? '—'} />
            <Info label="Vendor" value={ci.vendor?.name ?? ci.vendor_name ?? '—'} />
            <Info label="Contract Ref" value={ci.contract ? `${ci.contract.contract_number} — ${ci.contract.name}` : ci.contract_ref ?? '—'} />
            <Info label="Asset ที่ผูก" value={ci.asset ? `${ci.asset.asset_code} — ${ci.asset.name}` : '—'} />
            <Info label="Cloud Ref" value={ci.cloud_ref ?? '—'} />
            <Info label="RPO / RTO" value={`${ci.rpo_hours ?? '—'} / ${ci.rto_hours ?? '—'} ชม.`} />
            <Info label="Backup" value={ci.backup_required ? `ต้องสำรอง (${ci.backup_reference ?? 'ไม่ระบุ ref'})` : 'ไม่ต้องสำรอง'} />
            <Info label="สถานที่" value={ci.location ?? '—'} />
            <Info label="ตรวจสอบล่าสุด" value={ci.last_verified_at ? formatThaiDate(ci.last_verified_at, 'd MMM yyyy HH:mm') : 'ยังไม่เคยตรวจสอบ'} />
            {ci.notes && <div className="col-span-full"><Info label="หมายเหตุ" value={ci.notes} /></div>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>สถานะ / ตรวจสอบ</CardHeader>
          <CardBody className="flex flex-col gap-3">
            <RequirePermission permission="cmdb.manage">
              <div className="flex flex-col gap-2">
                <select value={statusValue} onChange={(e) => setStatusValue(e.target.value)} data-testid="ci-status-select" className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-900">
                  <option value="">เปลี่ยนสถานะ...</option>
                  {CI_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                {(statusValue === 'Degraded' || statusValue === 'Retired') && (
                  <input
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                    placeholder="เหตุผล (จำเป็น)"
                    data-testid="ci-status-reason"
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
                  />
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!statusValue}
                  isLoading={statusMutation.isPending}
                  data-testid="ci-status-save"
                  onClick={() =>
                    statusMutation.mutate(
                      { status: statusValue, reason: statusReason || undefined },
                      { onSuccess: () => { setStatusValue(''); setStatusReason(''); } },
                    )
                  }
                >
                  บันทึกสถานะ
                </Button>
              </div>

              <Button size="sm" variant="outline" className="w-full" isLoading={verifyMutation.isPending} data-testid="ci-verify-submit" onClick={() => verifyMutation.mutate({})}>
                ตรวจสอบแล้ว (Verify)
              </Button>
            </RequirePermission>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <span>ความสัมพันธ์ (CI Relationships)</span>
          <RequirePermission permission="cmdb.manage">
            <Button size="sm" variant="outline" onClick={() => setShowAddRel((v) => !v)} data-testid="ci-rel-add-toggle">
              <Plus className="h-4 w-4" aria-hidden="true" />
              เพิ่มความสัมพันธ์
            </Button>
          </RequirePermission>
        </CardHeader>
        <CardBody>
          {showAddRel && nodeOptionsQuery.data && ci.id && (
            <CreateRelationshipForm ciId={ci.id} nodeOptions={nodeOptionsQuery.data} onClose={() => setShowAddRel(false)} />
          )}

          {relationships.length === 0 && <p className="text-sm text-slate-400">ยังไม่มีความสัมพันธ์</p>}
          {relationships.length > 0 && (
            <div className="overflow-x-auto">
              <DataTable className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">ต้นทาง</th>
                    <th className="px-2 py-2">ความสัมพันธ์</th>
                    <th className="px-2 py-2">ปลายทาง</th>
                    <th className="px-2 py-2">Impact</th>
                    <th className="px-2 py-2">สถานะ</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {relationships.map((r) => {
                    const isSource = r.source_type === 'CI' && r.source_id === ci.id;
                    return (
                      <tr key={r.id} data-testid={`ci-rel-row-${r.id}`} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{isSource ? `${ci.name} (นี้)` : (r.sourceName ?? `${r.source_type}:${r.source_id.slice(0, 8)}`)}</td>
                        <td className="px-2 py-2">{r.relationship_type}</td>
                        <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{!isSource ? `${ci.name} (นี้)` : (r.targetName ?? `${r.target_type}:${r.target_id.slice(0, 8)}`)}</td>
                        <td className="px-2 py-2">{r.impact_level}</td>
                        <td className="px-2 py-2">
                          <Badge variant={relationshipStatusTone[r.status]}>{r.status}</Badge>
                        </td>
                        <td className="px-2 py-2">
                          <RequirePermission permission="cmdb.manage">
                            <button type="button" data-testid={`ci-rel-verify-${r.id}`} className="text-xs text-primary-700 hover:underline dark:text-primary-300" onClick={() => relVerifyMutation.mutate(r.id)}>
                              Verify
                            </button>
                          </RequirePermission>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-400">{label}</p>
      <p className="text-slate-700 dark:text-slate-200">{value}</p>
    </div>
  );
}
