import { DataTable } from '../../components/table/DataTable';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Loader2, Paperclip, QrCode, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { PageTitle } from '../../components/ui/PageTitle';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { AssetCategory, Department, EmployeeOption } from '../../types/admin';
import type { AssetAttachment, AssetDetail, AssetLifecycleStatus, AssetModelCatalog, AssetOption } from '../../types/assets';
import type { ContractOption, ContractVendorRef } from '../../types/vendorsContracts';
import { formatThaiDate } from '../../utils/date';
import { ASSET_AUDIT_RESULTS, ASSET_CRITICALITIES, ASSET_LIFECYCLE_LABELS, ASSET_LIFECYCLE_STATUSES, ASSET_STATUSES, ASSET_TYPES, assetLifecycleTone, assetStatusTone, employeeName, formatMoney } from './assetDisplay';

type ActionMode = null | 'assign' | 'return' | 'transfer' | 'repair-send' | 'repair-return' | 'verify';

function useAssetMutation(id: string, path: string, invalidateAlso?: string[]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch(`/api/v1/assets/${id}${path}`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['asset', id] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      for (const key of invalidateAlso ?? []) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}

const editSchema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อทรัพย์สิน'),
  categoryId: z.string().optional(),
  assetType: z.enum(ASSET_TYPES).optional(),
  brand: z.string().trim().optional(),
  model: z.string().trim().optional(),
  serialNumber: z.string().trim().optional(),
  vendorId: z.string().optional(),
  contractId: z.string().optional(),
  purchaseOrder: z.string().optional(),
  invoiceNumber: z.string().optional(),
  location: z.string().trim().optional(),
  purchaseDate: z.string().optional(),
  warrantyExpire: z.string().optional(),
  price: z.coerce.number().nonnegative().optional().or(z.literal('')),
  usefulLifeYears: z.coerce.number().int().positive().optional().or(z.literal('')),
  depreciationMethod: z.enum(['straight_line', 'declining_balance', 'none']).optional(),
  depreciationRate: z.coerce.number().nonnegative().max(100).optional().or(z.literal('')),
  costCenter: z.string().optional(),
  barcode: z.string().optional(),
  assetModelCatalogId: z.string().optional(),
  parentAssetId: z.string().optional(),
  criticality: z.enum(ASSET_CRITICALITIES).optional().or(z.literal('')),
  patchStatus: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  remark: z.string().trim().optional(),
});
type EditForm = z.infer<typeof editSchema>;

function EditAssetForm({
  detail,
  categories,
  vendors,
  contracts,
  models,
  assetOptions,
  onClose,
}: {
  detail: AssetDetail;
  categories: AssetCategory[];
  vendors: ContractVendorRef[];
  contracts: ContractOption[];
  models: AssetModelCatalog[];
  assetOptions: AssetOption[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const a = detail.asset;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: a.name,
      categoryId: a.category_id ?? '',
      assetType: a.asset_type as EditForm['assetType'],
      brand: a.brand ?? '',
      model: a.model ?? '',
      serialNumber: a.serial_number ?? '',
      vendorId: a.vendor_id ?? '',
      contractId: a.contract_id ?? '',
      purchaseOrder: a.purchase_order ?? '',
      invoiceNumber: a.invoice_number ?? '',
      location: a.location ?? '',
      purchaseDate: a.purchase_date ?? '',
      warrantyExpire: a.warranty_expire ?? '',
      price: a.price ?? '',
      usefulLifeYears: a.useful_life_years ?? '',
      depreciationMethod: a.depreciation_method ?? 'straight_line',
      depreciationRate: a.depreciation_rate ?? '',
      costCenter: a.cost_center ?? '',
      barcode: a.barcode ?? '',
      assetModelCatalogId: a.asset_model_catalog_id ?? '',
      parentAssetId: a.parent_asset_id ?? '',
      criticality: (a.criticality as EditForm['criticality']) ?? '',
      patchStatus: a.patch_status ?? '',
      notes: a.notes ?? '',
      remark: a.remark ?? '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: EditForm) =>
      apiFetch(`/api/v1/assets/${a.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...values,
          categoryId: values.categoryId || undefined,
          vendorId: values.vendorId || undefined,
          contractId: values.contractId || undefined,
          assetModelCatalogId: values.assetModelCatalogId || undefined,
          parentAssetId: values.parentAssetId || undefined,
          price: values.price === '' ? undefined : values.price,
          usefulLifeYears: values.usefulLifeYears === '' ? undefined : values.usefulLifeYears,
          depreciationRate: values.depreciationRate === '' ? undefined : values.depreciationRate,
          criticality: values.criticality || undefined,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['asset', a.id] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      onClose();
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'แก้ไขทรัพย์สินไม่สำเร็จ'),
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      data-testid="asset-edit-form"
      className="grid grid-cols-1 gap-x-4 gap-y-4 p-5 sm:grid-cols-3"
      noValidate
    >
      <div className="sm:col-span-2">
        <label htmlFor="ed-name" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ชื่อทรัพย์สิน</label>
        <input id="ed-name" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('name')} />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>
      <div>
        <label htmlFor="ed-category" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หมวดหมู่</label>
        <select id="ed-category" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('categoryId')}>
          <option value="">— ไม่ระบุ —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="ed-type" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ประเภท (ISMS)</label>
        <select id="ed-type" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('assetType')}>
          {ASSET_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="ed-brand" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ยี่ห้อ</label>
        <input id="ed-brand" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('brand')} />
      </div>
      <div>
        <label htmlFor="ed-model" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">รุ่น</label>
        <input id="ed-model" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('model')} />
      </div>
      <div>
        <label htmlFor="ed-serial" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">S/N</label>
        <input id="ed-serial" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('serialNumber')} />
      </div>
      <div>
        <label htmlFor="ed-vendor" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้จำหน่าย</label>
        <select id="ed-vendor" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('vendorId')}><option value="">— ไม่ระบุ —</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_code} — {vendor.name}</option>)}</select>
      </div>
      <div>
        <label htmlFor="ed-contract" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สัญญาที่ครอบคลุม</label>
        <select id="ed-contract" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('contractId')}><option value="">— ไม่ระบุ —</option>{contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_number} — {contract.name}</option>)}</select>
      </div>
      <div>
        <label htmlFor="ed-purchase-order" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Purchase Order</label>
        <input id="ed-purchase-order" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('purchaseOrder')} />
      </div>
      <div>
        <label htmlFor="ed-invoice" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Invoice</label>
        <input id="ed-invoice" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('invoiceNumber')} />
      </div>
      <div>
        <label htmlFor="ed-cost-center" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Cost Center</label>
        <input id="ed-cost-center" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('costCenter')} />
      </div>
      <div>
        <label htmlFor="ed-location" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สถานที่</label>
        <input id="ed-location" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('location')} />
      </div>
      <div>
        <label htmlFor="ed-criticality" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ความสำคัญ (ISMS)</label>
        <select id="ed-criticality" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('criticality')}>
          <option value="">— ไม่ระบุ —</option>
          {ASSET_CRITICALITIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="ed-purchase" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">วันที่ซื้อ</label>
        <input id="ed-purchase" type="date" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('purchaseDate')} />
      </div>
      <div>
        <label htmlFor="ed-warranty" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หมดประกัน</label>
        <input id="ed-warranty" type="date" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('warrantyExpire')} />
      </div>
      <div>
        <label htmlFor="ed-price" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ราคา (บาท)</label>
        <input id="ed-price" type="number" step="0.01" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('price')} />
      </div>
      <div>
        <label htmlFor="ed-life" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">อายุการใช้งาน (ปี)</label>
        <input id="ed-life" type="number" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('usefulLifeYears')} />
      </div>
      <div>
        <label htmlFor="ed-depreciation-method" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Depreciation</label>
        <select id="ed-depreciation-method" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('depreciationMethod')}>
          <option value="straight_line">Straight-line</option>
          <option value="declining_balance">Declining balance</option>
          <option value="none">ไม่คิดค่าเสื่อม</option>
        </select>
      </div>
      <div>
        <label htmlFor="ed-depreciation-rate" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Depreciation Rate (%)</label>
        <input id="ed-depreciation-rate" type="number" min="0" max="100" step="0.01" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('depreciationRate')} />
      </div>
      <div>
        <label htmlFor="ed-barcode" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">QR / Barcode</label>
        <input id="ed-barcode" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('barcode')} />
      </div>
      <div>
        <label htmlFor="ed-model-catalog" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Asset Model Catalog</label>
        <select id="ed-model-catalog" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('assetModelCatalogId')}>
          <option value="">— ไม่ระบุ —</option>
          {models.map((model) => <option key={model.id} value={model.id}>{model.model_code} — {model.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="ed-parent-asset" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Parent Asset</label>
        <select id="ed-parent-asset" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('parentAssetId')}>
          <option value="">— ไม่มี Parent —</option>
          {assetOptions.filter((option) => option.id !== a.id).map((option) => <option key={option.id} value={option.id}>{option.asset_code} — {option.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="ed-patch" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สถานะ Patch (ISMS)</label>
        <input id="ed-patch" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('patchStatus')} />
      </div>
      <div className="sm:col-span-3">
        <label htmlFor="ed-notes" className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หมายเหตุ</label>
        <textarea id="ed-notes" rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" {...register('notes')} />
      </div>

      {serverError && <p className="text-xs text-red-600 sm:col-span-3">{serverError}</p>}

      <div className="-mx-5 -mb-5 mt-2 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:col-span-3 dark:border-slate-700 dark:bg-slate-900/40">
        <Button type="button" size="sm" variant="outline" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" size="sm" isLoading={isSubmitting || mutation.isPending} data-testid="asset-edit-save">บันทึกการแก้ไข</Button>
      </div>
    </form>
  );
}

function ActionPanel({ assetId, employees, departments, vendors, onDone }: { assetId: string; employees: EmployeeOption[]; departments: Department[]; vendors: ContractVendorRef[]; onDone: () => void }) {
  const [mode, setMode] = useState<ActionMode>(null);
  const assign = useAssetMutation(assetId, '/assign', ['employee-assignments']);
  const returnMut = useAssetMutation(assetId, '/return');
  const transfer = useAssetMutation(assetId, '/transfer');
  const repairSend = useAssetMutation(assetId, '/send-to-repair');
  const repairReturn = useAssetMutation(assetId, '/return-from-repair');
  const verify = useAssetMutation(assetId, '/verify');

  const tabs: { key: ActionMode; label: string; permission: string }[] = [
    { key: 'assign', label: 'ยืม/มอบหมาย', permission: 'asset.transfer' },
    { key: 'return', label: 'คืน', permission: 'asset.transfer' },
    { key: 'transfer', label: 'โอนย้าย', permission: 'asset.transfer' },
    { key: 'repair-send', label: 'ส่งซ่อม', permission: 'asset.transfer' },
    { key: 'repair-return', label: 'รับคืนจากซ่อม', permission: 'asset.transfer' },
    { key: 'verify', label: 'ตรวจนับ (Stocktake)', permission: 'asset.update' },
  ];

  const done = () => {
    setMode(null);
    onDone();
  };

  const actionTitle: Record<Exclude<ActionMode, null>, string> = {
    assign: 'ยืม / มอบหมายทรัพย์สิน',
    return: 'รับคืนทรัพย์สิน',
    transfer: 'โอนย้ายทรัพย์สิน',
    'repair-send': 'ส่งทรัพย์สินซ่อม',
    'repair-return': 'รับคืนทรัพย์สินจากซ่อม',
    verify: 'ตรวจนับทรัพย์สิน (Stocktake)',
  };

  const actionPending = assign.isPending || returnMut.isPending || transfer.isPending || repairSend.isPending || repairReturn.isPending || verify.isPending;

  return (
    <>
      <Card>
        <CardHeader>ดำเนินการทรัพย์สิน</CardHeader>
        <CardBody>
          <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <RequirePermission key={tab.key} permission={tab.permission}>
              <button
                type="button"
                data-testid={`asset-action-${tab.key}`}
                aria-haspopup="dialog"
                onClick={() => setMode(mode === tab.key ? null : tab.key)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${mode === tab.key ? 'bg-primary-700 text-white' : 'border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}
              >
                {tab.label}
              </button>
            </RequirePermission>
          ))}
          </div>
        </CardBody>
      </Card>

      {mode && (
        <Modal title={actionTitle[mode]} size="lg" closeDisabled={actionPending} onClose={() => setMode(null)} testId={`asset-action-dialog-${mode}`}>
          <div className="p-5">
            {mode === 'assign' && (
              <AssignForm
                employees={employees}
                departments={departments}
                onSubmit={(v) => assign.mutate(v, { onSuccess: done })}
                isLoading={assign.isPending}
                error={assign.error instanceof ApiError ? assign.error.message : null}
              />
            )}
            {mode === 'return' && (
              <ReturnForm onSubmit={(v) => returnMut.mutate(v, { onSuccess: done })} isLoading={returnMut.isPending} error={returnMut.error instanceof ApiError ? returnMut.error.message : null} />
            )}
            {mode === 'transfer' && (
              <TransferForm
                employees={employees}
                departments={departments}
                onSubmit={(v) => transfer.mutate(v, { onSuccess: done })}
                isLoading={transfer.isPending}
                error={transfer.error instanceof ApiError ? transfer.error.message : null}
              />
            )}
            {mode === 'repair-send' && (
              <RepairSendForm vendors={vendors} onSubmit={(v) => repairSend.mutate(v, { onSuccess: done })} isLoading={repairSend.isPending} error={repairSend.error instanceof ApiError ? repairSend.error.message : null} />
            )}
            {mode === 'repair-return' && (
              <RepairReturnForm onSubmit={(v) => repairReturn.mutate(v, { onSuccess: done })} isLoading={repairReturn.isPending} error={repairReturn.error instanceof ApiError ? repairReturn.error.message : null} />
            )}
            {mode === 'verify' && (
              <VerifyForm onSubmit={(v) => verify.mutate(v, { onSuccess: done })} isLoading={verify.isPending} error={verify.error instanceof ApiError ? verify.error.message : null} />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function AssignForm({ employees, departments, onSubmit, isLoading, error }: { employees: EmployeeOption[]; departments: Department[]; onSubmit: (v: Record<string, unknown>) => void; isLoading: boolean; error: string | null }) {
  const [toEmployeeId, setToEmployeeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [location, setLocation] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <div data-testid="asset-form-assign" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้รับ/ผู้ถือครอง</label>
        <select value={toEmployeeId} onChange={(e) => setToEmployeeId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900">
          <option value="">— เลือกพนักงาน —</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{[e.prefix_th, e.first_name_th, e.last_name_th].filter(Boolean).join(' ')}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หน่วยงาน</label>
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900">
          <option value="">— ไม่ระบุ —</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name_th}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สถานที่</label>
        <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">กำหนดคืน</label>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หมายเหตุ</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      {error && <p className="text-xs text-red-600 sm:col-span-2">{error}</p>}
      <div className="flex justify-end sm:col-span-2">
        <Button
          size="sm"
          isLoading={isLoading}
          disabled={!toEmployeeId}
          data-testid="asset-assign-submit"
          onClick={() => onSubmit({ toEmployeeId, departmentId: departmentId || undefined, location: location || undefined, dueDate: dueDate || undefined, notes: notes || undefined })}
        >
          บันทึกการยืม/มอบหมาย
        </Button>
      </div>
    </div>
  );
}

function ReturnForm({ onSubmit, isLoading, error }: { onSubmit: (v: Record<string, unknown>) => void; isLoading: boolean; error: string | null }) {
  const [location, setLocation] = useState('');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <div data-testid="asset-form-return" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สถานที่รับคืน</label>
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="คลัง IT" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สภาพ</label>
        <input value={condition} onChange={(e) => setCondition(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หมายเหตุ</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      {error && <p className="text-xs text-red-600 sm:col-span-2">{error}</p>}
      <div className="flex justify-end sm:col-span-2">
        <Button size="sm" isLoading={isLoading} data-testid="asset-return-submit" onClick={() => onSubmit({ location: location || undefined, condition: condition || undefined, notes: notes || undefined })}>
          บันทึกการคืน
        </Button>
      </div>
    </div>
  );
}

function TransferForm({ employees, departments, onSubmit, isLoading, error }: { employees: EmployeeOption[]; departments: Department[]; onSubmit: (v: Record<string, unknown>) => void; isLoading: boolean; error: string | null }) {
  const [toEmployeeId, setToEmployeeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [location, setLocation] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <div data-testid="asset-form-transfer" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้รับใหม่</label>
        <select value={toEmployeeId} onChange={(e) => setToEmployeeId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900">
          <option value="">— ไม่เปลี่ยนผู้รับ —</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{[e.prefix_th, e.first_name_th, e.last_name_th].filter(Boolean).join(' ')}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หน่วยงานปลายทาง</label>
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900">
          <option value="">— ไม่ระบุ —</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name_th}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สถานที่ปลายทาง</label>
        <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">กำหนดคืน</label>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หมายเหตุ</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      {error && <p className="text-xs text-red-600 sm:col-span-2">{error}</p>}
      <div className="flex justify-end sm:col-span-2">
        <Button
          size="sm"
          isLoading={isLoading}
          disabled={!toEmployeeId && !departmentId && !location}
          data-testid="asset-transfer-submit"
          onClick={() => onSubmit({ toEmployeeId: toEmployeeId || undefined, departmentId: departmentId || undefined, location: location || undefined, dueDate: dueDate || undefined, notes: notes || undefined })}
        >
          บันทึกการโอนย้าย
        </Button>
      </div>
    </div>
  );
}

function RepairSendForm({ vendors, onSubmit, isLoading, error }: { vendors: ContractVendorRef[]; onSubmit: (v: Record<string, unknown>) => void; isLoading: boolean; error: string | null }) {
  const [vendorId, setVendorId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <div data-testid="asset-form-repair-send" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้ให้บริการซ่อม</label>
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"><option value="">— ระบุชื่อเอง —</option>{vendors.filter((vendor) => vendor.status === 'Active').map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_code} — {vendor.name}</option>)}</select>
      </div>
      {!vendorId && <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ชื่อผู้ให้บริการ (กรณีไม่มีในทะเบียน)</label><input value={vendorName} onChange={(e) => setVendorName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" /></div>}
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สถานที่</label>
        <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หมายเหตุ</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      {error && <p className="text-xs text-red-600 sm:col-span-2">{error}</p>}
      <div className="flex justify-end sm:col-span-2">
        <Button size="sm" isLoading={isLoading} data-testid="asset-repair-send-submit" onClick={() => onSubmit({ vendorId: vendorId || undefined, vendorName: vendorName || undefined, location: location || undefined, notes: notes || undefined })}>
          บันทึกส่งซ่อม
        </Button>
      </div>
    </div>
  );
}

function RepairReturnForm({ onSubmit, isLoading, error }: { onSubmit: (v: Record<string, unknown>) => void; isLoading: boolean; error: string | null }) {
  const [location, setLocation] = useState('');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <div data-testid="asset-form-repair-return" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สถานที่รับคืน</label>
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="คลัง IT" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สภาพหลังซ่อม</label>
        <input value={condition} onChange={(e) => setCondition(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หมายเหตุ</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      {error && <p className="text-xs text-red-600 sm:col-span-2">{error}</p>}
      <div className="flex justify-end sm:col-span-2">
        <Button size="sm" isLoading={isLoading} data-testid="asset-repair-return-submit" onClick={() => onSubmit({ location: location || undefined, condition: condition || undefined, notes: notes || undefined })}>
          บันทึกรับคืนจากซ่อม
        </Button>
      </div>
    </div>
  );
}

function VerifyForm({ onSubmit, isLoading, error }: { onSubmit: (v: Record<string, unknown>) => void; isLoading: boolean; error: string | null }) {
  const [result, setResult] = useState<string>(ASSET_AUDIT_RESULTS[0]);
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  return (
    <div data-testid="asset-form-verify" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผลการตรวจนับ</label>
        <select value={result} onChange={(e) => setResult(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900">
          {ASSET_AUDIT_RESULTS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ตำแหน่งจริง (ถ้าผิดตำแหน่ง)</label>
        <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">บันทึกเพิ่มเติม</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900" />
      </div>
      {error && <p className="text-xs text-red-600 sm:col-span-2">{error}</p>}
      <div className="flex justify-end sm:col-span-2">
        <Button size="sm" isLoading={isLoading} data-testid="asset-verify-submit" onClick={() => onSubmit({ result, location: location || undefined, note: note || undefined })}>
          บันทึกผลตรวจนับ
        </Button>
      </div>
    </div>
  );
}

function AssetLifecyclePanel({ asset, events, onDone }: { asset: AssetDetail['asset']; events: AssetDetail['lifecycleEvents']; onDone: () => void }) {
  const current: AssetLifecycleStatus = ASSET_LIFECYCLE_STATUSES.includes(asset.lifecycle_status) ? asset.lifecycle_status : 'ready';
  const transitionTargets: Record<AssetLifecycleStatus, AssetLifecycleStatus[]> = {
    ordered: ['received'],
    received: ['ready'],
    ready: ['checked_out', 'disposed'],
    checked_out: ['repair', 'returned'],
    repair: ['returned'],
    returned: ['ready', 'checked_out', 'disposed'],
    disposed: [],
  };
  const [notes, setNotes] = useState('');
  const mutation = useMutation({
    mutationFn: (toStatus: AssetLifecycleStatus) => apiFetch(`/api/v1/assets/${asset.id}/lifecycle`, { method: 'POST', body: JSON.stringify({ toStatus, notes: notes.trim() || undefined }) }),
    onSuccess: () => { setNotes(''); onDone(); },
  });

  return (
    <Card data-testid="asset-lifecycle-panel">
      <CardHeader className="flex items-center justify-between gap-2">
        <span>Asset Lifecycle</span>
        <Badge variant={assetLifecycleTone[current]}>{ASSET_LIFECYCLE_LABELS[current]}</Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
          {ASSET_LIFECYCLE_STATUSES.map((status) => {
            const isCurrent = status === current;
            const isPast = ASSET_LIFECYCLE_STATUSES.indexOf(status) < ASSET_LIFECYCLE_STATUSES.indexOf(current);
            return <div key={status} className={`rounded-lg border px-2 py-2 text-center text-xs ${isCurrent ? 'border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-950 dark:text-primary-200' : isPast ? 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-200' : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'}`}><span className="block font-semibold">{ASSET_LIFECYCLE_LABELS[status]}</span><span className="mt-0.5 block font-mono text-[10px] uppercase">{status.replace('_', ' ')}</span></div>;
          })}
        </div>
        {transitionTargets[current].length > 0 && <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[220px] flex-1 text-xs font-semibold text-slate-600 dark:text-slate-300">หมายเหตุการเปลี่ยนขั้นตอน
            <input value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-normal dark:border-slate-600 dark:bg-slate-900" maxLength={500} />
          </label>
          {transitionTargets[current].map((status) => <Button key={status} size="sm" variant={status === 'disposed' ? 'danger' : 'outline'} isLoading={mutation.isPending} disabled={mutation.isPending} onClick={() => mutation.mutate(status)} data-testid={`asset-lifecycle-${status}`}>
            ไป: {ASSET_LIFECYCLE_LABELS[status]}
          </Button>)}
        </div>}
        {mutation.error instanceof ApiError && <p className="text-xs text-red-600">{mutation.error.message}</p>}
        {events.length > 0 && <div className="border-t border-slate-100 pt-3 dark:border-slate-700"><p className="mb-2 text-xs font-semibold text-slate-500">ประวัติ Lifecycle ล่าสุด</p><div className="space-y-1.5 text-xs">{events.slice(0, 5).map((event) => <div key={event.id} className="flex items-center justify-between gap-2"><span>{event.from_status ? ASSET_LIFECYCLE_LABELS[event.from_status] : 'เริ่มต้น'} → {ASSET_LIFECYCLE_LABELS[event.to_status]}</span><span className="text-slate-400">{new Date(event.event_date).toLocaleDateString('th-TH')}</span></div>)}</div></div>}
      </CardBody>
    </Card>
  );
}

function AssetAttachments({ assetId, attachments, onDone }: { assetId: string; attachments: AssetAttachment[]; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('module', 'asset');
      form.append('targetTable', 'assets');
      form.append('targetId', assetId);
      return apiFetch('/api/v1/files', { method: 'POST', body: form });
    },
    onSuccess: () => { setError(null); if (inputRef.current) inputRef.current.value = ''; onDone(); },
    onError: (value) => setError(value instanceof ApiError ? value.message : 'อัปโหลดไฟล์ไม่สำเร็จ'),
  });
  const openAttachment = async (id: string) => {
    try {
      const result = await apiFetch<{ url: string }>(`/api/v1/files/${id}/signed-url`);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch {
      setError('เปิดไฟล์ไม่สำเร็จ');
    }
  };

  return <Card>
    <CardHeader className="flex items-center gap-2"><Paperclip className="h-4 w-4" />ไฟล์แนบ ({attachments.length})</CardHeader>
    <CardBody className="space-y-3">
      <RequirePermission permission="asset.update">
        <div className="flex flex-wrap items-center gap-2"><input ref={inputRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); }} disabled={upload.isPending} className="max-w-full text-sm" /><Upload className="h-4 w-4 text-slate-400" />{upload.isPending && <span className="text-xs text-slate-500">กำลังอัปโหลด...</span>}</div>
      </RequirePermission>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {attachments.length === 0 ? <p className="text-sm text-slate-400">ยังไม่มีเอกสารแนบ</p> : <div className="space-y-1">{attachments.map((attachment) => <button key={attachment.id} type="button" onClick={() => void openAttachment(attachment.id)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"><span className="min-w-0 truncate">{attachment.original_filename}</span><span className="flex shrink-0 items-center gap-1 text-xs text-primary-700 dark:text-primary-300"><ExternalLink className="h-3.5 w-3.5" />เปิด</span></button>)}</div>}
    </CardBody>
  </Card>;
}

export function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);
  const [statusValue, setStatusValue] = useState('');

  const detailQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: () => apiFetch<AssetDetail>(`/api/v1/assets/${id}`),
    enabled: Boolean(id),
  });
  const categoriesQuery = useQuery({ queryKey: ['admin', 'asset-categories'], queryFn: () => apiFetch<AssetCategory[]>('/api/v1/asset-categories') });
  const modelsQuery = useQuery({ queryKey: ['assets', 'models'], queryFn: () => apiFetch<AssetModelCatalog[]>('/api/v1/assets/models') });
  const assetOptionsQuery = useQuery({ queryKey: ['assets', 'options'], queryFn: () => apiFetch<AssetOption[]>('/api/v1/assets/options') });
  const employeesQuery = useQuery({ queryKey: ['employee-options'], queryFn: () => apiFetch<EmployeeOption[]>('/api/v1/employees/options') });
  const departmentsQuery = useQuery({ queryKey: ['admin', 'departments'], queryFn: () => apiFetch<Department[]>('/api/v1/departments') });
  const vendorOptionsQuery = useQuery({ queryKey: ['vendors-contracts', 'vendor-options'], queryFn: () => apiFetch<ContractVendorRef[]>('/api/v1/vendors/options') });
  const contractOptionsQuery = useQuery({ queryKey: ['vendors-contracts', 'contract-options'], queryFn: () => apiFetch<ContractOption[]>('/api/v1/contracts/options') });

  const statusMutation = useMutation({
    mutationFn: (status: string) => apiFetch(`/api/v1/assets/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['asset', id] }),
  });
  const retireMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/assets/${id}/retire`, { method: 'POST', body: '{}' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['asset', id] }),
  });
  const qrMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/assets/${id}/qr`, { method: 'POST', body: '{}' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['asset', id] }),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="flex justify-center py-16" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
      </div>
    );
  }
  if (!detailQuery.data) return null;

  const { asset, movements, maintenance, licenses } = detailQuery.data;

  return (
    <div className="flex flex-col gap-4" data-testid="asset-detail-page">
      <button type="button" onClick={() => navigate('/assets')} className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        กลับไปทะเบียนทรัพย์สิน
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitle eyebrow="ทรัพย์สินและโครงสร้างพื้นฐาน / ทะเบียนทรัพย์สิน" title={<>{asset.name}</>} description={<>{asset.asset_code}</>} />
        <div className="flex items-center gap-2">
          <Badge variant={assetStatusTone[asset.status]}>{asset.status}</Badge>
          <RequirePermission permission="asset.update">
            <Button size="sm" variant="outline" onClick={() => setShowEdit(true)} data-testid="asset-detail-edit-toggle" aria-haspopup="dialog">
              แก้ไข
            </Button>
          </RequirePermission>
        </div>
      </div>

      {showEdit && (
        <Modal title={`แก้ไขทรัพย์สิน: ${asset.name}`} size="xl" onClose={() => setShowEdit(false)} testId="asset-edit-dialog">
          {categoriesQuery.data && vendorOptionsQuery.data && contractOptionsQuery.data && modelsQuery.data && assetOptionsQuery.data ? (
            <EditAssetForm detail={detailQuery.data} categories={categoriesQuery.data} vendors={vendorOptionsQuery.data} contracts={contractOptionsQuery.data} models={modelsQuery.data} assetOptions={assetOptionsQuery.data} onClose={() => setShowEdit(false)} />
          ) : (
            <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-slate-500" role="status">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              กำลังเตรียมแบบฟอร์ม...
            </div>
          )}
        </Modal>
      )}

      <AssetLifecyclePanel asset={asset} events={detailQuery.data.lifecycleEvents ?? []} onDone={() => { void queryClient.invalidateQueries({ queryKey: ['asset', id] }); void queryClient.invalidateQueries({ queryKey: ['assets'] }); }} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>รายละเอียดทรัพย์สิน</CardHeader>
          <CardBody className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <Info label="หมวดหมู่" value={asset.category?.name ?? '—'} />
            <Info label="ประเภท (ISMS)" value={asset.asset_type} />
            <Info label="ยี่ห้อ/รุ่น" value={[asset.brand, asset.model].filter(Boolean).join(' / ') || '—'} />
            <Info label="S/N" value={asset.serial_number ?? '—'} />
            <Info label="ผู้จำหน่าย" value={asset.vendor?.name ?? asset.vendor_name ?? '—'} />
            <Info label="สัญญา" value={asset.contract ? `${asset.contract.contract_number} — ${asset.contract.name}` : '—'} />
            <Info label="สถานที่" value={asset.location ?? '—'} />
            <Info label="ผู้ถือครอง" value={employeeName(asset.owner)} />
            <Info label="หน่วยงาน" value={asset.department?.name_th ?? '—'} />
            <Info label="กำหนดคืน" value={asset.loan_due_date ? formatThaiDate(asset.loan_due_date, 'd MMM yyyy') : '—'} />
            <Info label="วันที่ซื้อ" value={asset.purchase_date ? formatThaiDate(asset.purchase_date, 'd MMM yyyy') : '—'} />
            <Info label="หมดประกัน" value={asset.warranty_expire ? formatThaiDate(asset.warranty_expire, 'd MMM yyyy') : '—'} />
            <Info label="Purchase Order" value={asset.purchase_order ?? '—'} />
            <Info label="Invoice" value={asset.invoice_number ?? '—'} />
            <Info label="Cost Center" value={asset.cost_center ?? '—'} />
            <Info label="QR / Barcode" value={asset.barcode ?? 'ใช้ Asset Code เป็น QR'} />
            <Info label="ราคา / มูลค่าคงเหลือ" value={`${formatMoney(asset.price)} / ${formatMoney(asset.bookValue)} บาท`} />
            <Info label="ค่าเสื่อม" value={asset.depreciationPct !== null ? `${asset.depreciationPct}%` : '—'} />
            <Info label="ความสำคัญ (ISMS)" value={asset.criticality ?? '—'} />
            <Info label="สถานะ Patch (ISMS)" value={asset.patch_status ?? '—'} />
            <Info label="ตรวจนับล่าสุด" value={asset.last_audit_date ? `${formatThaiDate(asset.last_audit_date, 'd MMM yyyy')} (${asset.audit_status ?? ''})` : 'ยังไม่เคยตรวจนับ'} />
            <Info label="Physical Verification" value={asset.physical_verification_status === 'verified' ? 'Verified' : asset.physical_verification_status === 'exception' ? 'Exception' : 'Pending'} />
            <Info label="Parent Asset" value={asset.parent_asset_id ?? 'ไม่มี'} />
            <Info label="CMDB CI" value={detailQuery.data.configurationItem ? `${detailQuery.data.configurationItem.ci_code} — ${detailQuery.data.configurationItem.name}` : 'ยังไม่มี CI'} />
            {(detailQuery.data.children ?? []).length > 0 && <Info label="Child Assets" value={(detailQuery.data.children ?? []).map((child) => `${child.asset_code} — ${child.name}`).join(', ')} />}
            {asset.notes && <div className="col-span-full"><Info label="หมายเหตุ" value={asset.notes} /></div>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <span>QR Code</span>
            <RequirePermission permission="asset.update">
              <button type="button" onClick={() => qrMutation.mutate()} data-testid="asset-qr-regenerate" className="text-primary-700 hover:underline dark:text-primary-300">
                <QrCode className="h-4 w-4" aria-hidden="true" />
              </button>
            </RequirePermission>
          </CardHeader>
          <CardBody className="flex flex-col items-center gap-3">
            {asset.qr_code_url && <img src={asset.qr_code_url} alt={`QR ${asset.asset_code}`} className="h-40 w-40" />}

            <RequirePermission permission="asset.update">
              <div className="flex w-full items-center gap-2">
                <select value={statusValue} onChange={(e) => setStatusValue(e.target.value)} data-testid="asset-status-select" className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-900">
                  <option value="">เปลี่ยนสถานะ...</option>
                  {ASSET_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!statusValue}
                  isLoading={statusMutation.isPending}
                  data-testid="asset-status-save"
                  onClick={() => statusMutation.mutate(statusValue, { onSuccess: () => setStatusValue('') })}
                >
                  บันทึก
                </Button>
              </div>
            </RequirePermission>

            <RequirePermission permission="asset.dispose">
              {asset.status !== 'จำหน่าย/เลิกใช้' && (
                <Button size="sm" variant="danger" className="w-full" isLoading={retireMutation.isPending} data-testid="asset-retire" onClick={() => retireMutation.mutate()}>
                  จำหน่าย/เลิกใช้ทรัพย์สิน
                </Button>
              )}
            </RequirePermission>
          </CardBody>
        </Card>
      </div>

      <ActionPanel
        assetId={asset.id}
        employees={employeesQuery.data ?? []}
        departments={departmentsQuery.data ?? []}
        vendors={vendorOptionsQuery.data ?? []}
        onDone={() => void queryClient.invalidateQueries({ queryKey: ['asset', id] })}
      />

      <AssetAttachments assetId={asset.id} attachments={detailQuery.data.attachments ?? []} onDone={() => void queryClient.invalidateQueries({ queryKey: ['asset', id] })} />

      <Card>
        <CardHeader>ประวัติการเคลื่อนไหว</CardHeader>
        <CardBody>
          {movements.length === 0 && <p className="text-sm text-slate-400">ยังไม่มีประวัติ</p>}
          {movements.length > 0 && (
            <div className="overflow-x-auto">
              <DataTable className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-2 py-2">วันที่</th>
                    <th className="px-2 py-2">รายการ</th>
                    <th className="px-2 py-2">จาก</th>
                    <th className="px-2 py-2">ถึง</th>
                    <th className="px-2 py-2">หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{formatThaiDate(m.action_date, 'd MMM yyyy HH:mm')}</td>
                      <td className="px-2 py-2">{m.status_label ?? m.action_type}</td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{employeeName(m.from_employee)}</td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{m.to_employee ? employeeName(m.to_employee) : (m.vendor?.name ?? m.vendor_name ?? '—')}</td>
                      <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{m.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>ประวัติ PM/บำรุงรักษา</CardHeader>
          <CardBody>
            {maintenance.length === 0 && <p className="text-sm text-slate-400">ยังไม่มีแผน PM</p>}
            {maintenance.map((p) => (
              <div key={p.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0 dark:border-slate-700">
                <span>{formatThaiDate(p.plan_date, 'd MMM yyyy')}</span>
                <span className="text-slate-500 dark:text-slate-400">{p.status}</span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>License ที่เกี่ยวข้อง</CardHeader>
          <CardBody>
            {licenses.length === 0 && <p className="text-sm text-slate-400">ไม่มี License ที่ผูกกับทรัพย์สินนี้</p>}
            {licenses.map((l) => (
              <div key={l.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0 dark:border-slate-700">
                <span>{l.software_name}</span>
                <span className="text-slate-500 dark:text-slate-400">{l.expire_date ? formatThaiDate(l.expire_date, 'd MMM yyyy') : '—'}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
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
