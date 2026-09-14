import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Camera, Check, CheckCircle2, ClipboardCheck, CloudOff, CloudUpload, FileBarChart2,
  MapPin, RefreshCw, ScanLine, ShieldAlert, Trash2, UserRound, Wifi,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { ApiError, apiFetch, showToast } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import {
  compressEvidencePhoto, dataUrlToFile, readFieldScanQueue, removeFieldScanItem, saveFieldScanItem,
  type FieldScanResult, type LocalFieldScanItem,
} from './fieldScanOffline';
import { QrScanner } from './QrScanner';

interface FieldCampaign {
  id: string;
  campaign_code: string;
  name: string;
  planned_date: string;
  location: string | null;
  status: 'draft' | 'active' | 'completed';
  completed_at: string | null;
  verificationCount: number;
}

interface ResolvedAsset {
  id: string;
  assetCode: string;
  name: string;
  assetType: string | null;
  serialNumber: string | null;
  location: string | null;
  ownerEmployeeId: string | null;
  ownerName: string | null;
}

interface EmployeeOption {
  id: string;
  employee_code: string;
  first_name_th: string;
  last_name_th: string;
}

interface SyncedVerification {
  id: string;
  clientRef: string;
  assetId: string;
}

interface SyncResponse {
  savedCount: number;
  verifications: SyncedVerification[];
}

const RESULT_OPTIONS: Array<{ value: FieldScanResult; label: string; tone: 'success' | 'warning' | 'danger' | 'primary' }> = [
  { value: 'found', label: 'พบ', tone: 'success' },
  { value: 'not_found', label: 'ไม่พบ', tone: 'danger' },
  { value: 'wrong_location', label: 'ผิดสถานที่', tone: 'warning' },
  { value: 'wrong_custodian', label: 'ผู้ถือครองผิด', tone: 'primary' },
];

const CAMPAIGN_STORAGE_KEY = 'itlife-field-scan-campaign';
const defaultCampaignName = `ตรวจนับทรัพย์สินปี ${new Date().getFullYear() + 543}`;

function readStoredCampaign(): FieldCampaign | null {
  try {
    const raw = localStorage.getItem(CAMPAIGN_STORAGE_KEY);
    if (!raw?.startsWith('{')) return null;
    return JSON.parse(raw) as FieldCampaign;
  } catch {
    return null;
  }
}

function readStoredCampaignId(): string {
  const stored = readStoredCampaign();
  if (stored) return stored.id;
  return localStorage.getItem(CAMPAIGN_STORAGE_KEY) ?? '';
}

function clientRef(): string {
  const random = globalThis.crypto?.randomUUID;
  return typeof random === 'function' ? random.call(globalThis.crypto) : `field-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function scannedCode(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return (url.searchParams.get('code') ?? url.pathname.split('/').filter(Boolean).pop() ?? '').trim();
    } catch {
      return trimmed.split('|')[0].trim();
    }
  }
  return trimmed.split('|')[0].trim();
}

function newLocalItem(campaignId: string, asset: ResolvedAsset | null, rawCode: string): LocalFieldScanItem {
  return {
    clientRef: clientRef(),
    campaignId,
    assetId: asset?.id ?? null,
    assetCode: asset?.assetCode ?? scannedCode(rawCode),
    assetName: asset?.name ?? 'รอเชื่อมต่อเพื่อยืนยัน Asset',
    assetType: asset?.assetType ?? null,
    serialNumber: asset?.serialNumber ?? null,
    expectedLocation: asset?.location ?? '',
    actualLocation: asset?.location ?? '',
    expectedCustodianEmployeeId: asset?.ownerEmployeeId ?? null,
    expectedCustodianName: asset?.ownerName ?? null,
    actualCustodianEmployeeId: asset?.ownerEmployeeId ?? null,
    result: 'found',
    note: '',
    scannedAt: new Date().toISOString(),
    photoDataUrl: null,
    serverId: null,
    syncState: 'pending',
    photoUploaded: false,
  };
}

function employeeLabel(employee: EmployeeOption): string {
  return `${employee.employee_code} · ${employee.first_name_th} ${employee.last_name_th}`;
}

export function AssetVerificationPage() {
  const { hasPermission } = useAuth();
  const canUpdate = hasPermission('asset.update');
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [campaignId, setCampaignId] = useState(readStoredCampaignId);
  const [offlineCampaign, setOfflineCampaign] = useState<FieldCampaign | null>(readStoredCampaign);
  const [items, setItems] = useState<LocalFieldScanItem[]>([]);
  const [campaignName, setCampaignName] = useState(defaultCampaignName);
  const [campaignLocation, setCampaignLocation] = useState('');
  const [scannerMessage, setScannerMessage] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  const campaignsQuery = useQuery({
    queryKey: ['field-scan', 'campaigns'],
    queryFn: () => apiFetch<FieldCampaign[]>('/api/v1/assets/field/campaigns'),
    retry: false,
    enabled: online,
  });
  const campaigns = useMemo(() => campaignsQuery.data ?? [], [campaignsQuery.data]);
  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId) ?? (offlineCampaign?.id === campaignId ? offlineCampaign : null);

  useEffect(() => {
    if (!campaignId && campaigns[0]) {
      setCampaignId(campaigns[0].id);
      setOfflineCampaign(campaigns[0]);
      localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(campaigns[0]));
    }
  }, [campaignId, campaigns]);

  useEffect(() => {
    if (!campaignId) { setItems([]); return; }
    let alive = true;
    void readFieldScanQueue(campaignId).then((queue) => { if (alive) setItems(queue.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt))); });
    return () => { alive = false; };
  }, [campaignId]);

  const employeesQuery = useQuery({
    queryKey: ['field-scan', 'employees'],
    queryFn: () => apiFetch<EmployeeOption[]>('/api/v1/employees/options'),
    enabled: Boolean(campaignId) && online,
    retry: false,
  });
  const employees = employeesQuery.data ?? [];

  const createCampaign = useMutation({
    mutationFn: () => apiFetch<FieldCampaign>('/api/v1/assets/field/campaigns', {
      method: 'POST', body: JSON.stringify({ name: campaignName.trim(), location: campaignLocation.trim() || undefined }),
    }),
    onSuccess: (campaign) => {
      setCampaignId(campaign.id);
      setOfflineCampaign(campaign);
      localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(campaign));
      setCampaignName(defaultCampaignName);
      setCampaignLocation('');
      void campaignsQuery.refetch();
    },
  });

  const resolveAsset = useMutation({
    mutationFn: (raw: string) => apiFetch<ResolvedAsset>(`/api/v1/assets/field/resolve?code=${encodeURIComponent(raw)}`),
    onSuccess: (asset, raw) => addItem(asset, raw),
    onError: (error, raw) => {
      // A code can still be captured without network; the server resolves it on the next sync.
      if (campaignId && (!online || (error instanceof ApiError && ['NETWORK_ERROR', 'REQUEST_TIMEOUT'].includes(error.code)))) {
        addItem(null, raw);
        setScannerMessage(`บันทึก ${scannedCode(raw)} ไว้ในคิวออฟไลน์แล้ว`);
      } else setScannerMessage(errorText(error, 'ยืนยัน Asset ไม่สำเร็จ'));
    },
  });

  const sync = useMutation({
    mutationFn: async (): Promise<{ response: SyncResponse; photoFailures: number; photoUploadedRefs: string[] }> => {
      const pending = items.filter((item) => item.syncState !== 'synced' || (item.photoDataUrl && !item.photoUploaded));
      const response = await apiFetch<SyncResponse>(`/api/v1/assets/field/campaigns/${campaignId}/sync`, {
        method: 'POST',
        body: JSON.stringify({ items: pending.map((item) => ({
          clientRef: item.clientRef,
          assetCode: item.assetCode,
          result: item.result,
          expectedLocation: item.expectedLocation || undefined,
          actualLocation: item.actualLocation || undefined,
          expectedCustodianEmployeeId: item.expectedCustodianEmployeeId,
          actualCustodianEmployeeId: item.actualCustodianEmployeeId,
          note: item.note || undefined,
          scannedAt: item.scannedAt,
        })) }),
      });
      const serverByClientRef = new Map(response.verifications.map((verification) => [verification.clientRef, verification]));
      let photoFailures = 0;
      const photoUploadedRefs: string[] = [];
      for (const item of pending) {
        const saved = serverByClientRef.get(item.clientRef);
        if (!saved || !item.photoDataUrl || item.photoUploaded) continue;
        try {
          const form = new FormData();
          form.append('file', dataUrlToFile(item.photoDataUrl, `${item.assetCode}-evidence.jpg`));
          form.append('module', 'asset_verification');
          form.append('targetTable', 'asset_verifications');
          form.append('targetId', saved.id);
          await apiFetch('/api/v1/files', { method: 'POST', body: form }, { silent: true });
          photoUploadedRefs.push(item.clientRef);
        } catch {
          photoFailures += 1;
        }
      }
      return { response, photoFailures, photoUploadedRefs };
    },
    onSuccess: ({ response, photoFailures, photoUploadedRefs }) => {
      const savedByClientRef = new Map(response.verifications.map((verification) => [verification.clientRef, verification]));
      const uploaded = new Set(photoUploadedRefs);
      setItems((current) => current.map((item) => {
        const saved = savedByClientRef.get(item.clientRef);
        if (!saved) return item;
        const hadPhoto = Boolean(item.photoDataUrl);
        return { ...item, assetId: saved.assetId, serverId: saved.id, syncState: 'synced', photoUploaded: hadPhoto ? uploaded.has(item.clientRef) : item.photoUploaded };
      }));
      void campaignsQuery.refetch();
      showToast(photoFailures ? 'error' : 'success', photoFailures ? `ซิงก์แล้ว แต่รูปหลักฐานค้าง ${photoFailures} รายการ` : `ซิงก์ผลตรวจนับแล้ว ${response.savedCount} รายการ`);
    },
  });

  const complete = useMutation({
    mutationFn: () => apiFetch<FieldCampaign>(`/api/v1/assets/field/campaigns/${campaignId}/complete`, { method: 'POST' }),
    onSuccess: () => { void campaignsQuery.refetch(); showToast('success', 'ปิด Campaign ตรวจนับแล้ว'); },
  });

  const stats = useMemo(() => ({
    total: items.length,
    found: items.filter((item) => item.result === 'found').length,
    exceptions: items.filter((item) => item.result !== 'found').length,
    pending: items.filter((item) => item.syncState !== 'synced' || (item.photoDataUrl && !item.photoUploaded)).length,
  }), [items]);

  function addItem(asset: ResolvedAsset | null, rawCode: string) {
    if (!campaignId) { setScannerMessage('กรุณาสร้างหรือเลือก Campaign ก่อนสแกน'); return; }
    const code = asset?.assetCode ?? scannedCode(rawCode);
    if (!code) { setScannerMessage('อ่านรหัสจาก Barcode/QR ไม่ได้'); return; }
    if (items.some((item) => item.assetCode.toLocaleLowerCase('th-TH') === code.toLocaleLowerCase('th-TH'))) {
      setScannerMessage(`${code} อยู่ใน Batch นี้แล้ว`);
      return;
    }
    const item = newLocalItem(campaignId, asset, code);
    setItems((current) => [item, ...current]);
    void saveFieldScanItem(item);
    setScannerMessage(`${code} เพิ่มใน Batch แล้ว — ตรวจผลและกดซิงก์เมื่อพร้อม`);
  }

  function updateItem(clientRef: string, patch: Partial<LocalFieldScanItem>) {
    setItems((current) => current.map((item) => {
      if (item.clientRef !== clientRef) return item;
      const next = { ...item, ...patch };
      void saveFieldScanItem(next);
      return next;
    }));
  }

  function removeItem(item: LocalFieldScanItem) {
    setItems((current) => current.filter((currentItem) => currentItem.clientRef !== item.clientRef));
    void removeFieldScanItem(item.clientRef);
  }

  async function onPhotoChange(item: LocalFieldScanItem, file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    try {
      const photoDataUrl = await compressEvidencePhoto(file);
      updateItem(item.clientRef, { photoDataUrl, photoUploaded: false });
    } catch (error) {
      setPhotoError(errorText(error, 'เก็บรูปหลักฐานไม่สำเร็จ'));
    }
  }

  const hasPending = stats.pending > 0;
  const canScan = Boolean(campaignId && selectedCampaign?.status === 'active');

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5" data-testid="asset-verification-page">
      <PageHeader
        eyebrow="ทรัพย์สิน / Field Audit"
        title="สแกนหน้างาน"
        description="ตรวจนับ Asset แบบ Batch พร้อมยืนยันสถานที่ ผู้ถือครอง และรูปหลักฐาน — ทำงานต่อได้แม้ออฟไลน์"
        leading={<ScanLine className="h-4 w-4" aria-hidden="true" />}
        secondaryActions={<Link to="/reports?report=asset-verification" className="inline-flex min-h-9 items-center gap-2 rounded-[7px] border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-primary-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"><FileBarChart2 className="h-4 w-4" />รายงาน Asset Verification</Link>}
        primaryAction={<Button size="sm" onClick={() => document.getElementById('field-campaign-name')?.focus()}><ClipboardCheck className="h-4 w-4" />เริ่ม Campaign</Button>}
      />

      <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${online ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'}`} role="status">
        <span className="flex items-center gap-2">{online ? <Wifi className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}<strong>{online ? 'ออนไลน์' : 'ออฟไลน์'}</strong><span className="hidden sm:inline">{online ? 'พร้อมซิงก์ผลตรวจนับและรูปหลักฐาน' : 'สแกนต่อได้ ระบบจะเก็บคิวไว้ในเครื่องและซิงก์ภายหลัง'}</span></span>
        {hasPending && <Badge variant={online ? 'warning' : 'secondary'}>{stats.pending} รายการรอซิงก์</Badge>}
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-primary-600" />Campaign ตรวจนับ</span>{campaignsQuery.isFetching && <RefreshCw className="h-4 w-4 animate-spin text-slate-400" aria-label="กำลังโหลด Campaign" />}</CardHeader>
        <CardBody className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">เลือก Campaign
            <select aria-label="Campaign ตรวจนับ" value={campaignId} onChange={(event) => { const nextId = event.target.value; const nextCampaign = campaigns.find((campaign) => campaign.id === nextId) ?? null; setCampaignId(nextId); setOfflineCampaign(nextCampaign); localStorage.setItem(CAMPAIGN_STORAGE_KEY, nextCampaign ? JSON.stringify(nextCampaign) : nextId); }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-900">
              <option value="">— สร้าง Campaign ใหม่ —</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.status === 'completed' ? 'ปิดแล้ว' : `${campaign.verificationCount} รายการ`}</option>)}
            </select>
          </label>
          {selectedCampaign ? <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900/50"><p className="font-mono text-[10px] text-slate-400">{selectedCampaign.campaign_code}</p><p className="mt-0.5 font-semibold">{selectedCampaign.location || 'ไม่จำกัดสถานที่'} · แผน {selectedCampaign.planned_date}</p></div> : <div />}
          {selectedCampaign && <Badge variant={selectedCampaign.status === 'active' ? 'success' : 'secondary'}>{selectedCampaign.status === 'active' ? 'กำลังตรวจ' : 'ปิดแล้ว'}</Badge>}
          {!selectedCampaign && <div className="md:col-span-3 grid gap-3 border-t border-slate-100 pt-3 dark:border-slate-800 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">ชื่อ Campaign<input id="field-campaign-name" value={campaignName} onChange={(event) => setCampaignName(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-900" /></label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">สถานที่หลัก (ไม่บังคับ)<input value={campaignLocation} onChange={(event) => setCampaignLocation(event.target.value)} placeholder="เช่น อาคาร A / ชั้น 3" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-900" /></label>
            <Button isLoading={createCampaign.isPending} disabled={!canUpdate || !campaignName.trim()} onClick={() => createCampaign.mutate()}>สร้าง Campaign</Button>
          </div>}
          {campaignsQuery.isError && <p className="text-xs text-amber-700 md:col-span-3 dark:text-amber-200">โหลด Campaign จากระบบไม่สำเร็จ — ถ้าเคยเปิด Campaign ไว้ ให้ตรวจสอบคิวในเครื่องแล้วลองเชื่อมต่อใหม่</p>}
          {!canUpdate && <p className="text-xs text-amber-700 md:col-span-3 dark:text-amber-200">บัญชีนี้ดูข้อมูลได้ แต่ไม่มีสิทธิ์บันทึกผลตรวจนับ (ต้องมี asset.update)</p>}
        </CardBody>
      </Card>

      {campaignId && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <StatCard icon={<ScanLine className="h-5 w-5" />} label="สแกนแล้ว" value={stats.total} />
            <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="พบ" value={stats.found} tone="teal" />
            <StatCard icon={<ShieldAlert className="h-5 w-5" />} label="ต้องติดตาม" value={stats.exceptions} tone="danger" />
            <StatCard icon={<CloudUpload className="h-5 w-5" />} label="รอซิงก์" value={stats.pending} tone="amber" />
          </div>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2"><ScanLine className="h-4 w-4 text-primary-600" />QR / Barcode Scan</span><span className="text-xs font-normal text-slate-500">สแกนต่อเนื่องได้ — รายการจะเข้า Batch ด้านล่าง</span></CardHeader>
            <CardBody>
              {!canScan && <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">Campaign นี้ปิดแล้ว จึงดูผลเดิมได้อย่างเดียว</p>}
              <div className={!canScan || !canUpdate ? 'pointer-events-none opacity-60' : ''}><QrScanner busy={resolveAsset.isPending} onDetected={(raw) => { setScannerMessage(null); resolveAsset.mutate(raw); }} /></div>
              {resolveAsset.isPending && <p className="mt-3 text-center text-xs text-slate-500" role="status">กำลังยืนยัน Asset...</p>}
              {scannerMessage && <p className="mt-3 rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-xs text-primary-800 dark:border-primary-900 dark:bg-primary-950/30 dark:text-primary-200" role="status">{scannerMessage}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-primary-600" />Batch Scan <Badge variant="primary">{items.length} รายการ</Badge></span><span className="text-xs font-normal text-slate-500">แก้ผลตรวจแต่ละรายการก่อนซิงก์</span></CardHeader>
            <CardBody className="space-y-3">
              {items.length === 0 ? <EmptyState icon={<ScanLine className="h-8 w-8" />} title="ยังไม่มีรายการใน Batch" message="สแกน QR/Barcode หรือพิมพ์รหัส Asset ที่ต้องตรวจนับ" /> : items.map((item) => (
                <VerificationRow key={item.clientRef} item={item} employees={employees} disabled={!canUpdate || selectedCampaign?.status !== 'active'} onChange={updateItem} onRemove={removeItem} onPhotoChange={onPhotoChange} />
              ))}
              {photoError && <p className="text-xs text-danger-700 dark:text-danger-200" role="alert">{photoError}</p>}
            </CardBody>
          </Card>

          <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            <p className="text-xs text-slate-500">{stats.total ? `ตรวจ ${stats.total} รายการ · ${stats.exceptions} รายการต้องติดตาม` : 'เริ่มจากการสแกน Asset แรก'}</p>
            <div className="flex flex-wrap gap-2">
              {selectedCampaign?.status === 'active' && <Button variant="outline" size="sm" disabled={!canUpdate || !online || !hasPending || sync.isPending} isLoading={sync.isPending} onClick={() => sync.mutate()}><CloudUpload className="h-4 w-4" />ซิงก์ภายหลัง</Button>}
              {selectedCampaign?.status === 'active' && <Button variant="success" size="sm" disabled={!canUpdate || !online || hasPending || !stats.total || complete.isPending} isLoading={complete.isPending} onClick={() => complete.mutate()}><Check className="h-4 w-4" />ปิด Campaign</Button>}
              <Link to="/reports?report=asset-verification" className="inline-flex min-h-9 items-center gap-2 rounded-[7px] border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-primary-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"><FileBarChart2 className="h-4 w-4" />เปิดรายงาน</Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function VerificationRow({
  item, employees, disabled, onChange, onRemove, onPhotoChange,
}: {
  item: LocalFieldScanItem;
  employees: EmployeeOption[];
  disabled: boolean;
  onChange: (clientRef: string, patch: Partial<LocalFieldScanItem>) => void;
  onRemove: (item: LocalFieldScanItem) => void;
  onPhotoChange: (item: LocalFieldScanItem, file: File | undefined) => void;
}) {
  const result = RESULT_OPTIONS.find((option) => option.value === item.result) ?? RESULT_OPTIONS[0];
  const resultVariant = result.tone === 'primary' ? 'primary' : result.tone;
  return (
    <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-700" data-testid={`field-verification-${item.assetCode}`}>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-200"><PackageIcon /></div>
        <div className="min-w-0 flex-1"><p className="font-mono text-xs font-bold text-primary-700 dark:text-primary-300">{item.assetCode}</p><h3 className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{item.assetName}</h3>{item.serialNumber && <p className="text-[11px] text-slate-500">Serial: {item.serialNumber}</p>}</div>
        <div className="flex items-center gap-2"><Badge variant={item.syncState === 'synced' ? 'success' : 'warning'}>{item.syncState === 'synced' ? 'ซิงก์แล้ว' : 'รอซิงก์'}</Badge><button type="button" aria-label={`ลบ ${item.assetCode} ออกจาก Batch`} onClick={() => onRemove(item)} disabled={disabled} className="rounded-md p-1.5 text-slate-400 hover:bg-danger-50 hover:text-danger-700 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button></div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">ผลตรวจ
          <select aria-label={`ผลตรวจ ${item.assetCode}`} value={item.result} onChange={(event) => onChange(item.clientRef, { result: event.target.value as FieldScanResult, syncState: 'pending', photoUploaded: false })} disabled={disabled} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-900">{RESULT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        </label>
        <div className="flex items-end"><Badge variant={resultVariant}>{result.label}{item.result === 'found' ? ' / ตรงข้อมูล' : ' / ต้องติดตาม'}</Badge></div>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300"><span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />สถานที่ตามทะเบียน</span><input value={item.expectedLocation} readOnly className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-500 dark:border-slate-700 dark:bg-slate-900/50" /></label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300"><span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />สถานที่พบจริง</span><input aria-label={`สถานที่พบจริง ${item.assetCode}`} value={item.actualLocation} onChange={(event) => onChange(item.clientRef, { actualLocation: event.target.value, syncState: 'pending' })} disabled={disabled} placeholder="ระบุเมื่ออยู่คนละสถานที่" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-900" /></label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300"><span className="flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />ผู้ถือครองตามทะเบียน</span><input value={item.expectedCustodianName ?? 'ยังไม่ระบุ'} readOnly className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-500 dark:border-slate-700 dark:bg-slate-900/50" /></label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300"><span className="flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />ผู้ถือครองปัจจุบัน</span><select aria-label={`ผู้ถือครองปัจจุบัน ${item.assetCode}`} value={item.actualCustodianEmployeeId ?? ''} onChange={(event) => onChange(item.clientRef, { actualCustodianEmployeeId: event.target.value || null, syncState: 'pending' })} disabled={disabled} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-900"><option value="">ไม่ระบุ / ไม่มีผู้ถือครอง</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employeeLabel(employee)}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 md:col-span-2">หมายเหตุ<input aria-label={`หมายเหตุ ${item.assetCode}`} value={item.note} onChange={(event) => onChange(item.clientRef, { note: event.target.value, syncState: 'pending' })} disabled={disabled} placeholder="เช่น พบเครื่องแต่ป้ายชำรุด / ย้ายห้องแล้ว" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal dark:border-slate-600 dark:bg-slate-900" /></label>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600 md:col-span-2 dark:text-slate-300"><Camera className="h-4 w-4 text-primary-600" />รูปหลักฐาน<input type="file" accept="image/*" capture="environment" disabled={disabled} onChange={(event) => { onPhotoChange(item, event.target.files?.[0]); event.currentTarget.value = ''; }} className="min-w-0 flex-1 text-xs font-normal" />{item.photoDataUrl && <span className="text-success-700">แนบแล้ว</span>}</label>
      </div>
      {item.photoDataUrl && <img src={item.photoDataUrl} alt={`รูปหลักฐาน ${item.assetCode}`} className="mt-3 h-24 w-32 rounded-lg object-cover ring-1 ring-slate-200 dark:ring-slate-700" />}
    </article>
  );
}

function PackageIcon() {
  return <span className="font-mono text-xs font-bold">AST</span>;
}
