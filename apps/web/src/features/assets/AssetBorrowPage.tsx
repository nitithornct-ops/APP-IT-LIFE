import { DataTable, TablePagination } from '../../components/table/DataTable';
import { useTableParams } from '../../hooks/useTableParams';
import { ExportCsvButton } from '../../components/table/ExportCsvButton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeftRight, CalendarClock, CheckCircle2, ClipboardCheck, Eye, History, ImagePlus, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RequirePermission } from '../../components/RequirePermission';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { FilterBar, filterControlClass } from '../../components/ui/FilterBar';
import { KpiStrip } from '../../components/ui/KpiStrip';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { Department, EmployeeOption, PaginatedResult } from '../../types/admin';
import type { ActiveAssetLoan, AssetBorrowMovement, AssetBorrowSummary, AssetLoan, AssetOption } from '../../types/assets';
import { WordLikeEditor } from '../forms/WordLikeEditor';
import { exportHtmlAsWord } from '../../utils/formHtml';
import { formatThaiDate } from '../../utils/date';

type BorrowView = 'active' | 'history';
type MovementAction = 'assign' | 'return' | 'transfer';
type OverviewRecord = ActiveAssetLoan | AssetBorrowMovement;

interface BorrowOverviewResponse {
  summary: AssetBorrowSummary;
  records: PaginatedResult<OverviewRecord>;
}

const fieldClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900';

function isHistoryRecord(item: OverviewRecord): item is AssetBorrowMovement {
  return 'action_type' in item;
}

function fullName(person: { first_name_th: string; last_name_th: string } | null | undefined) {
  return person ? `${person.first_name_th} ${person.last_name_th}` : '—';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function dueState(dueDate: string | null) {
  if (!dueDate) return { label: 'ไม่กำหนด', variant: 'secondary' as const };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: `เกินกำหนด ${Math.abs(days)} วัน`, variant: 'danger' as const };
  if (days <= 7) return { label: days === 0 ? 'ครบกำหนดวันนี้' : `เหลือ ${days} วัน`, variant: 'warning' as const };
  return { label: formatThaiDate(dueDate, 'd MMM yyyy'), variant: 'secondary' as const };
}

async function uploadLoanPhotos(files: File[], loanId: string, stage: 'before' | 'after') {
  for (const file of files) {
    const body = new FormData();
    body.append('file', file);
    body.append('module', 'asset_loan');
    body.append('targetTable', 'asset_loans');
    body.append('targetId', loanId);
    body.append('stage', stage);
    await apiFetch('/api/v1/files', { method: 'POST', body }, { silent: true });
  }
}

function activeEmployees(employees: EmployeeOption[]) {
  return employees.filter((employee) => employee.status === 'active');
}

function employeeOptionLabel(employee: EmployeeOption) {
  return `${employee.employee_code} — ${[employee.prefix_th, employee.first_name_th, employee.last_name_th].filter(Boolean).join(' ')}`;
}

function MovementModal({
  assets,
  employees,
  departments,
  onClose,
  initialAction = 'assign',
  initialAssetId = '',
}: {
  assets: AssetOption[];
  employees: EmployeeOption[];
  departments: Department[];
  onClose: () => void;
  initialAction?: MovementAction;
  initialAssetId?: string;
}) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<MovementAction>(initialAction);
  const [assetId, setAssetId] = useState(initialAssetId);
  const [toEmployeeId, setToEmployeeId] = useState('');
  const [approverEmployeeId, setApproverEmployeeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [location, setLocation] = useState('');
  const [borrowedAt, setBorrowedAt] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [returnedAt, setReturnedAt] = useState(todayIso());
  const [returnReceiverEmployeeId, setReturnReceiverEmployeeId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [conditionBefore, setConditionBefore] = useState('');
  const [conditionAfter, setConditionAfter] = useState('');
  const [returnOutcome, setReturnOutcome] = useState<'good' | 'damaged' | 'lost'>('good');
  const [damageNotes, setDamageNotes] = useState('');
  const [companionEquipment, setCompanionEquipment] = useState('');
  const [reminderDaysBefore, setReminderDaysBefore] = useState('3');
  const [acknowledgementName, setAcknowledgementName] = useState('');
  const [borrowerAcknowledged, setBorrowerAcknowledged] = useState(false);
  const [beforePhotos, setBeforePhotos] = useState<File[]>([]);
  const [afterPhotos, setAfterPhotos] = useState<File[]>([]);
  const [createdLoanId, setCreatedLoanId] = useState<string | null>(null);
  const [returnedLoanId, setReturnedLoanId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const employeesInService = activeEmployees(employees);
  const eligibleAssets = assets.filter((asset) => action === 'assign' ? asset.status === 'พร้อมใช้งาน' : asset.status === 'ใช้งานอยู่');

  const mutation = useMutation({
    mutationFn: async () => {
      if (action === 'assign') {
        const loanId = createdLoanId ?? (await apiFetch<{ loanId: string }>('/api/v1/assets/loans', {
          method: 'POST',
          body: JSON.stringify({
            assetId,
            borrowerEmployeeId: toEmployeeId,
            approverEmployeeId,
            borrowedAt,
            dueAt: dueDate,
            purpose,
            conditionBefore,
            companionEquipment: companionEquipment.split('\n').map((item) => item.trim()).filter(Boolean),
            borrowerAcknowledged,
            borrowerAcknowledgementName: acknowledgementName,
            reminderDaysBefore: Number(reminderDaysBefore),
            departmentId: departmentId || undefined,
            location: location || undefined,
          }),
        })).loanId;
        if (!createdLoanId) setCreatedLoanId(loanId);
        await uploadLoanPhotos(beforePhotos, loanId, 'before');
        return { loanId };
      }
      if (action === 'return') {
        const result = returnedLoanId
          ? { loanId: returnedLoanId }
          : await apiFetch<{ loanId?: string }>(`/api/v1/assets/${assetId}/return`, {
            method: 'POST',
            body: JSON.stringify({ returnedAt, returnReceiverEmployeeId, conditionAfter, returnOutcome, damageNotes: damageNotes || undefined, returnNotes: notes || undefined, location: location || undefined, condition: conditionAfter || undefined }),
          });
        if (result.loanId) setReturnedLoanId(result.loanId);
        if (result.loanId) await uploadLoanPhotos(afterPhotos, result.loanId, 'after');
        return result;
      }
      return apiFetch(`/api/v1/assets/${assetId}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ location: location || undefined, notes: notes || undefined, toEmployeeId: toEmployeeId || undefined, departmentId: departmentId || undefined, dueDate: dueDate || undefined }),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['asset-borrow'] }),
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
        queryClient.invalidateQueries({ queryKey: ['asset-options'] }),
        queryClient.invalidateQueries({ queryKey: ['asset-loan'] }),
      ]);
      onClose();
    },
  });

  const canSubmit = action === 'assign'
    ? Boolean(assetId && toEmployeeId && approverEmployeeId && borrowedAt && dueDate && dueDate >= borrowedAt && purpose.trim() && conditionBefore.trim() && beforePhotos.length > 0 && borrowerAcknowledged && acknowledgementName.trim())
    : action === 'return'
      ? Boolean(assetId && returnedAt && returnReceiverEmployeeId && conditionAfter.trim() && afterPhotos.length > 0 && (returnOutcome === 'good' || damageNotes.trim()))
      : Boolean(assetId && (toEmployeeId || departmentId || location));

  return <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2" data-testid="asset-borrow-movement-form">
    <div className="sm:col-span-2 rounded-lg border border-primary-100 bg-primary-50/60 px-3 py-2 text-xs text-primary-800 dark:border-primary-900 dark:bg-primary-950/30 dark:text-primary-200"><span className="font-semibold">ทะเบียนยืม/คืน Asset</span> — การบันทึกจะ Sync ผู้ถือครองและสถานะใน Asset Registry ให้อัตโนมัติ</div>
    <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">การดำเนินการ *</label><select className={fieldClass} value={action} onChange={(event) => { setAction(event.target.value as MovementAction); setAssetId(''); setCreatedLoanId(null); setReturnedLoanId(null); }}><option value="assign">ยืม / สร้างทะเบียน</option><option value="return">คืน</option><option value="transfer">โอนย้าย</option></select></div>
    <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Asset *</label><select className={fieldClass} value={assetId} onChange={(event) => setAssetId(event.target.value)} data-testid="asset-borrow-asset"><option value="">— เลือก —</option>{eligibleAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.asset_code} — {asset.name}</option>)}</select>{eligibleAssets.length === 0 && <p className="mt-1 text-xs text-amber-600">ไม่มี Asset ที่พร้อมสำหรับรายการนี้</p>}</div>

    {action === 'assign' && <>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้ยืม *</label><select className={fieldClass} value={toEmployeeId} onChange={(event) => setToEmployeeId(event.target.value)}><option value="">— เลือกพนักงาน —</option>{employeesInService.map((employee) => <option key={employee.id} value={employee.id}>{employeeOptionLabel(employee)}</option>)}</select></div>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้อนุมัติ *</label><select className={fieldClass} value={approverEmployeeId} onChange={(event) => setApproverEmployeeId(event.target.value)}><option value="">— เลือกผู้อนุมัติ —</option>{employeesInService.map((employee) => <option key={employee.id} value={employee.id}>{employeeOptionLabel(employee)}</option>)}</select></div>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">วันที่ยืม *</label><input type="date" className={fieldClass} value={borrowedAt} onChange={(event) => setBorrowedAt(event.target.value)} /></div>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">วันที่ต้องคืน *</label><input type="date" min={borrowedAt} className={fieldClass} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></div>
      <div className="sm:col-span-2"><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">วัตถุประสงค์ *</label><textarea rows={2} className={fieldClass} value={purpose} onChange={(event) => setPurpose(event.target.value)} maxLength={1000} placeholder="เช่น ใช้ปฏิบัติงานนอกสถานที่" /></div>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สภาพก่อนยืม *</label><textarea rows={2} className={fieldClass} value={conditionBefore} onChange={(event) => setConditionBefore(event.target.value)} maxLength={1000} placeholder="เช่น ปกติ มีรอยขีดข่วนเล็กน้อย" /></div>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">อุปกรณ์ประกอบ</label><textarea rows={2} className={fieldClass} value={companionEquipment} onChange={(event) => setCompanionEquipment(event.target.value)} placeholder="พิมพ์ 1 รายการต่อบรรทัด เช่น Adapter" /></div>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Reminder ก่อนถึงกำหนด</label><select className={fieldClass} value={reminderDaysBefore} onChange={(event) => setReminderDaysBefore(event.target.value)}><option value="0">วันครบกำหนด</option><option value="1">1 วันก่อน</option><option value="3">3 วันก่อน</option><option value="7">7 วันก่อน</option><option value="14">14 วันก่อน</option></select></div>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สถานที่ใช้งาน</label><input className={fieldClass} value={location} onChange={(event) => setLocation(event.target.value)} /></div>
      <div className="sm:col-span-2 rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-600"><label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"><ImagePlus className="h-4 w-4" />รูปภาพก่อนยืม * <span className="font-normal text-slate-400">เลือกได้หลายรูป</span></label><input className="mt-2 max-w-full text-sm" type="file" accept="image/*" multiple onChange={(event) => setBeforePhotos(Array.from(event.target.files ?? []))} data-testid="asset-borrow-before-photos" />{beforePhotos.length > 0 && <p className="mt-1 text-xs text-slate-500">เลือกแล้ว {beforePhotos.length} รูป</p>}</div>
      <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900 dark:bg-amber-950/20"><label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><input type="checkbox" checked={borrowerAcknowledged} onChange={(event) => setBorrowerAcknowledged(event.target.checked)} />ผู้ยืมรับทราบและยอมรับเงื่อนไขการดูแลทรัพย์สิน *</label><input className={`${fieldClass} mt-2`} value={acknowledgementName} onChange={(event) => setAcknowledgementName(event.target.value)} placeholder="ชื่อผู้ยืนยัน acknowledgement *" maxLength={200} /></div>
    </>}

    {action === 'return' && <>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">วันที่คืน *</label><input type="date" className={fieldClass} value={returnedAt} onChange={(event) => setReturnedAt(event.target.value)} /></div>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้รับคืน *</label><select className={fieldClass} value={returnReceiverEmployeeId} onChange={(event) => setReturnReceiverEmployeeId(event.target.value)}><option value="">— เลือกผู้รับคืน —</option>{employeesInService.map((employee) => <option key={employee.id} value={employee.id}>{employeeOptionLabel(employee)}</option>)}</select></div>
      <div className="sm:col-span-2"><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สภาพหลังคืน *</label><textarea rows={2} className={fieldClass} value={conditionAfter} onChange={(event) => setConditionAfter(event.target.value)} maxLength={1000} placeholder="ระบุสภาพจริงเมื่อรับคืน" /></div>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผลการตรวจรับ *</label><select className={fieldClass} value={returnOutcome} onChange={(event) => setReturnOutcome(event.target.value as typeof returnOutcome)}><option value="good">ปกติ / พร้อมใช้งาน</option><option value="damaged">ชำรุด / ส่งซ่อม</option><option value="lost">สูญหาย</option></select></div>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สถานที่รับคืน</label><input className={fieldClass} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="คลัง IT" /></div>
      {returnOutcome !== 'good' && <div className="sm:col-span-2"><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">รายละเอียด Damage / Lost *</label><textarea rows={2} className={fieldClass} value={damageNotes} onChange={(event) => setDamageNotes(event.target.value)} maxLength={1000} placeholder="อธิบายความเสียหายหรือรายละเอียดการสูญหาย" /></div>}
      <div className="sm:col-span-2 rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-600"><label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"><ImagePlus className="h-4 w-4" />รูปภาพหลังคืน * <span className="font-normal text-slate-400">เลือกได้หลายรูป</span></label><input className="mt-2 max-w-full text-sm" type="file" accept="image/*" multiple onChange={(event) => setAfterPhotos(Array.from(event.target.files ?? []))} data-testid="asset-borrow-after-photos" />{afterPhotos.length > 0 && <p className="mt-1 text-xs text-slate-500">เลือกแล้ว {afterPhotos.length} รูป</p>}</div>
      <div className="sm:col-span-2"><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หมายเหตุการคืน</label><textarea rows={2} className={fieldClass} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} /></div>
    </>}

    {action === 'transfer' && <>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้รับ/ผู้ถือครอง</label><select className={fieldClass} value={toEmployeeId} onChange={(event) => setToEmployeeId(event.target.value)}><option value="">— ไม่เปลี่ยน —</option>{employeesInService.map((employee) => <option key={employee.id} value={employee.id}>{employeeOptionLabel(employee)}</option>)}</select></div>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">แผนก</label><select className={fieldClass} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">— ไม่เปลี่ยน —</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name_th}</option>)}</select></div>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">สถานที่</label><input className={fieldClass} value={location} onChange={(event) => setLocation(event.target.value)} /></div>
      <div><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">กำหนดคืน</label><input type="date" className={fieldClass} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></div>
      <div className="sm:col-span-2"><label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">หมายเหตุ</label><textarea rows={3} className={fieldClass} value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
    </>}

    {mutation.error && <p className="text-xs text-red-600 sm:col-span-2">{mutation.error instanceof ApiError ? mutation.error.message : 'บันทึกรายการไม่สำเร็จ หากรายการถูกบันทึกแล้ว ให้ลองอัปโหลดรูปอีกครั้ง'}</p>}
    <div className="-mx-5 -mb-5 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:col-span-2 dark:border-slate-700 dark:bg-slate-900/40"><Button size="sm" variant="outline" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button><Button size="sm" disabled={!canSubmit} isLoading={mutation.isPending} onClick={() => mutation.mutate()} data-testid="asset-borrow-submit"><ClipboardCheck className="h-4 w-4" />บันทึกทะเบียน</Button></div>
  </div>;
}

function LoanDetailModal({ loan, onClose }: { loan: AssetLoan; onClose: () => void }) {
  const openAttachment = async (id: string) => {
    try {
      const result = await apiFetch<{ url: string }>(`/api/v1/files/${id}/signed-url`);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch {
      // The shared API client already shows the safe error toast.
    }
  };
  const beforePhotos = loan.attachments.filter((attachment) => attachment.asset_loan_stage === 'before');
  const afterPhotos = loan.attachments.filter((attachment) => attachment.asset_loan_stage === 'after');
  const due = loan.status === 'active' ? dueState(loan.due_at) : { label: 'คืนแล้ว', variant: 'success' as const };
  return <Modal title={`ทะเบียนยืม Asset ${loan.asset?.asset_code ?? ''}`} size="lg" onClose={onClose}><div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2"><div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm dark:border-slate-700 dark:bg-slate-900/50"><span className="font-semibold">{loan.asset?.name ?? 'Asset'}</span><Badge variant={due.variant}>{due.label}</Badge></div><div><p className="text-xs text-slate-500">ผู้ยืม</p><p className="font-medium">{fullName(loan.borrower)}</p></div><div><p className="text-xs text-slate-500">ผู้อนุมัติ</p><p className="font-medium">{fullName(loan.approver)}</p></div><div><p className="text-xs text-slate-500">วันที่ยืม</p><p>{formatThaiDate(loan.borrowed_at, 'd MMM yyyy')}</p></div><div><p className="text-xs text-slate-500">วันที่ต้องคืน</p><p>{formatThaiDate(loan.due_at, 'd MMM yyyy')}</p></div><div className="sm:col-span-2"><p className="text-xs text-slate-500">วัตถุประสงค์</p><p className="whitespace-pre-wrap">{loan.purpose}</p></div><div><p className="text-xs text-slate-500">สภาพก่อนยืม</p><p className="whitespace-pre-wrap">{loan.condition_before}</p></div><div><p className="text-xs text-slate-500">อุปกรณ์ประกอบ</p><p>{loan.companion_equipment.length ? loan.companion_equipment.join(', ') : 'ไม่มี'}</p></div><div><p className="text-xs text-slate-500">Acknowledgement ผู้ยืม</p><p>{loan.borrower_acknowledged ? `ยืนยันโดย ${loan.borrower_acknowledgement_name ?? 'ผู้ยืม'}` : 'ยังไม่ยืนยัน'}</p></div>{loan.status === 'returned' && <><div><p className="text-xs text-slate-500">ผู้รับคืน</p><p>{fullName(loan.return_receiver)}</p></div><div><p className="text-xs text-slate-500">วันที่คืน / ผลการคืน</p><p>{loan.returned_at ? formatThaiDate(loan.returned_at, 'd MMM yyyy') : '—'} · {loan.return_outcome === 'good' ? 'ปกติ' : loan.return_outcome === 'damaged' ? 'ชำรุด' : 'สูญหาย'}</p></div><div className="sm:col-span-2"><p className="text-xs text-slate-500">สภาพหลังคืน</p><p className="whitespace-pre-wrap">{loan.condition_after ?? '—'}</p></div>{loan.damage_notes && <div className="sm:col-span-2"><p className="text-xs text-slate-500">Damage / Lost</p><p className="whitespace-pre-wrap text-amber-700 dark:text-amber-300">{loan.damage_notes}</p></div>}</>}<div className="sm:col-span-2 grid gap-3 border-t border-slate-100 pt-3 dark:border-slate-700 sm:grid-cols-2"><PhotoList title="รูปก่อนยืม" items={beforePhotos} onOpen={openAttachment} /><PhotoList title="รูปหลังคืน" items={afterPhotos} onOpen={openAttachment} /></div><div className="sm:col-span-2 flex justify-end border-t border-slate-100 pt-3 dark:border-slate-700"><Button size="sm" variant="outline" onClick={onClose}>ปิด</Button></div></div></Modal>;
}

function PhotoList({ title, items, onOpen }: { title: string; items: AssetLoan['attachments']; onOpen: (id: string) => void }) {
  return <div><p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">{title} ({items.length})</p>{items.length ? <div className="space-y-1">{items.map((item) => <button key={item.id} type="button" onClick={() => onOpen(item.id)} className="block w-full truncate rounded border border-slate-200 px-2 py-1 text-left text-xs text-primary-700 hover:bg-primary-50 dark:border-slate-700 dark:text-primary-300">{item.original_filename}</button>)}</div> : <p className="text-xs text-slate-400">ยังไม่มีรูป</p>}</div>;
}

export function AssetBorrowPage() {
  const table = useTableParams<'view' | 'search' | 'departmentId'>({ filters: ['view', 'search', 'departmentId'] });
  const { page, pageSize } = table;
  const { search, departmentId } = table.filters;
  const view: BorrowView = table.filters.view === 'history' ? 'history' : 'active';
  const [movementPreset, setMovementPreset] = useState<{ action: MovementAction; assetId?: string } | null>(null);
  const [formAssetId, setFormAssetId] = useState<string>();
  const [detailLoanId, setDetailLoanId] = useState<string | null>(null);
  const borrowForm = useQuery({ queryKey: ['asset-borrow-form', formAssetId], queryFn: () => apiFetch<{ title: string; assetCode: string; contentHtml: string }>(`/api/v1/assets/${formAssetId}/borrow-form`), enabled: Boolean(formAssetId) });
  const detailLoanQuery = useQuery({ queryKey: ['asset-loan', detailLoanId], queryFn: () => apiFetch<AssetLoan>(`/api/v1/assets/loans/${detailLoanId}`), enabled: Boolean(detailLoanId) });
  const debouncedSearch = useDebouncedValue(search);
  const overviewQuery = useQuery({ queryKey: ['asset-borrow', view, page, pageSize, debouncedSearch, departmentId], queryFn: () => apiFetch<BorrowOverviewResponse>(`/api/v1/assets/borrow-overview?view=${view}&page=${page}&pageSize=${pageSize}${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''}${departmentId ? `&departmentId=${departmentId}` : ''}`) });
  const assetsQuery = useQuery({ queryKey: ['asset-options'], queryFn: () => apiFetch<AssetOption[]>('/api/v1/assets/options') });
  const employeesQuery = useQuery({ queryKey: ['employee-options'], queryFn: () => apiFetch<EmployeeOption[]>('/api/v1/employees/options') });
  const departmentsQuery = useQuery({ queryKey: ['admin', 'departments'], queryFn: () => apiFetch<Department[]>('/api/v1/departments') });
  const summary = overviewQuery.data?.summary ?? { available: 0, active: 0, dueSoon: 0, overdue: 0 };
  const records = overviewQuery.data?.records;
  const activeRecords = records?.items.filter((item): item is ActiveAssetLoan => !isHistoryRecord(item)) ?? [];
  const historyRecords = records?.items.filter(isHistoryRecord) ?? [];
  const activeFilterCount = [search, departmentId].filter(Boolean).length;

  return <div className="flex flex-col gap-5" data-testid="asset-borrow-page">
    <PageHeader eyebrow="ทรัพย์สินและโครงสร้างพื้นฐาน / ยืม-คืน Asset" title="ยืม / คืน / โอนย้าย Asset" description="ทะเบียนยืมคืนพร้อมผู้อนุมัติ หลักฐานสภาพ รูปภาพ และ acknowledgement" primaryAction={<RequirePermission permission="asset.transfer"><Button size="sm" onClick={() => setMovementPreset({ action: 'assign' })} data-testid="asset-borrow-create" aria-haspopup="dialog"><Plus className="h-4 w-4" />บันทึกการยืม Asset</Button></RequirePermission>} />
    <KpiStrip items={[{ key: 'available', label: 'พร้อมให้ยืม', value: summary.available, tone: 'teal', icon: <CheckCircle2 className="h-5 w-5" /> }, { key: 'active', label: 'กำลังถือครอง', value: summary.active, tone: 'gray', icon: <ArrowLeftRight className="h-5 w-5" />, active: view === 'active', onClick: () => table.setFilter('view', '') }, { key: 'due-soon', label: 'ใกล้ครบกำหนดคืน', value: summary.dueSoon, tone: 'amber', icon: <CalendarClock className="h-5 w-5" /> }, { key: 'overdue', label: 'ค้างคืน (เกินกำหนด)', value: summary.overdue, tone: 'danger', icon: <AlertTriangle className="h-5 w-5" /> }]} />
    <div className="flex border-b border-slate-200 dark:border-slate-700"><button type="button" onClick={() => table.setFilter('view', '')} className={`flex h-12 items-center gap-2 border-b-2 px-4 text-sm font-semibold ${view === 'active' ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-slate-500'}`}><ArrowLeftRight className="h-4 w-4" />กำลังถือครอง / ค้างคืน ({summary.active})</button><button type="button" onClick={() => table.setFilter('view', 'history')} className={`flex h-12 items-center gap-2 border-b-2 px-4 text-sm font-semibold ${view === 'history' ? 'border-primary-600 text-primary-700 dark:text-primary-300' : 'border-transparent text-slate-500'}`}><History className="h-4 w-4" />ประวัติเคลื่อนไหว</button></div>
    <Card className="overflow-hidden"><div className="p-3"><FilterBar className="border-0 bg-surface-header shadow-none dark:bg-white/[.028]" searchValue={search} onSearchChange={(value) => table.setFilter('search', value, { replace: true })} searchPlaceholder="ค้นหา Asset ผู้ถือครอง หรือรหัสพนักงาน..." filters={<select aria-label="กรองแผนก" value={departmentId} onChange={(event) => table.setFilter('departmentId', event.target.value)} className={filterControlClass}><option value="">แผนก: ทั้งหมด</option>{(departmentsQuery.data ?? []).map((department) => <option key={department.id} value={department.id}>{department.name_th}</option>)}</select>} onClear={() => table.setFilters({ search: '', departmentId: '' })} activeFilterCount={activeFilterCount} resultCount={records?.pagination.totalItems} actions={<ExportCsvButton className="self-center" disabled={view === 'active' ? !activeRecords.length : !historyRecords.length} fileName={`asset-${view === 'active' ? 'loans' : 'movements'}-page-${page}.csv`} getRows={() => view === 'active' ? [['Asset', 'รหัสทรัพย์สิน', 'ผู้ยืม', 'แผนก', 'วันที่ยืม', 'กำหนดคืน', 'วัตถุประสงค์'], ...activeRecords.map((item) => [item.name, item.asset_code, fullName(item.owner), item.department?.name_th ?? '', item.loan_date ? formatThaiDate(item.loan_date, 'd MMM yyyy') : '', item.loan_due_date ? formatThaiDate(item.loan_due_date, 'd MMM yyyy') : '', item.loan?.purpose ?? ''])] : [['วันเวลา', 'Asset', 'รายการ', 'จาก', 'ไปยัง', 'หมายเหตุ'], ...historyRecords.map((item) => [formatThaiDate(item.action_date, 'd MMM yyyy HH:mm'), item.asset?.name ?? '', item.status_label ?? item.action_type, fullName(item.from_employee), fullName(item.to_employee), item.notes ?? item.condition ?? ''])]} />} /></div>
      {overviewQuery.isLoading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {overviewQuery.error && <p className="py-8 text-center text-sm text-red-600">{overviewQuery.error instanceof ApiError ? overviewQuery.error.message : 'โหลดข้อมูลไม่สำเร็จ'}</p>}
      {records && records.items.length === 0 && <EmptyState icon={view === 'active' ? <ArrowLeftRight className="h-10 w-10" /> : <History className="h-10 w-10" />} title={view === 'active' ? 'ไม่มีทรัพย์สินที่ถูกยืมหรือถือครองอยู่' : 'ยังไม่มีประวัติการเคลื่อนไหว'} />}
      {view === 'active' && activeRecords.length > 0 && <DataTable mode="server" toolbar={false} pagination={false} currentPageExport={false} tableId="asset-borrow-active" rowNumberStart={(page - 1) * pageSize + 1} containerClassName="rounded-none border-x-0 shadow-none" className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40"><tr><th className="px-3 py-3">Asset</th><th className="px-3 py-3">ผู้ยืม</th><th className="px-3 py-3">แผนก / สถานที่</th><th className="px-3 py-3">ยืมเมื่อ</th><th className="px-3 py-3">กำหนดคืน</th><th className="px-3 py-3">วัตถุประสงค์</th><th className="px-3 py-3 text-right">จัดการ</th></tr></thead><tbody>{activeRecords.map((item) => { const due = dueState(item.loan_due_date); return <tr key={item.id} className="border-t border-slate-100 dark:border-slate-700"><td className="px-3 py-3"><Link to={`/assets/${item.id}`} className="font-semibold text-primary-700 hover:underline dark:text-primary-300">{item.name}</Link><p className="font-mono text-xs text-slate-400">{item.asset_code}</p></td><td className="px-3 py-3">{fullName(item.owner)}{item.owner?.employee_code && <p className="text-xs text-slate-400">{item.owner.employee_code}</p>}</td><td className="px-3 py-3 text-slate-500">{item.department?.name_th ?? '—'}<p className="text-xs">{item.location ?? ''}</p></td><td className="px-3 py-3 text-slate-500">{item.loan_date ? formatThaiDate(item.loan_date, 'd MMM yyyy') : '—'}</td><td className="px-3 py-3"><Badge variant={due.variant}>{due.label}</Badge></td><td className="max-w-[220px] truncate px-3 py-3 text-slate-500">{item.loan?.purpose ?? 'รายการเดิม (ยังไม่มีรายละเอียดทะเบียน)'}</td><td className="px-3 py-3 text-right"><div className="flex justify-end gap-1"><Button size="sm" variant="outline" onClick={() => setMovementPreset({ action: 'return', assetId: item.id })}>คืน</Button>{item.loan && <Button size="sm" variant="outline" onClick={() => setDetailLoanId(item.loan!.id)}><Eye className="h-3.5 w-3.5" />รายละเอียด</Button>}<Button size="sm" variant="outline" onClick={() => setFormAssetId(item.id)}>Word</Button></div></td></tr>; })}</tbody></DataTable>}
      {view === 'history' && historyRecords.length > 0 && <DataTable mode="server" toolbar={false} pagination={false} currentPageExport={false} tableId="asset-borrow-history" rowNumberStart={(page - 1) * pageSize + 1} containerClassName="rounded-none border-x-0 shadow-none" className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/40"><tr><th className="px-3 py-3">วันเวลา</th><th className="px-3 py-3">Asset</th><th className="px-3 py-3">รายการ</th><th className="px-3 py-3">จาก</th><th className="px-3 py-3">ไปยัง / แผนก</th><th className="px-3 py-3">หมายเหตุ</th></tr></thead><tbody>{historyRecords.map((item) => <tr key={item.id} className="border-t border-slate-100 dark:border-slate-700"><td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatThaiDate(item.action_date, 'd MMM yyyy HH:mm')}</td><td className="px-3 py-3">{item.asset ? <Link to={`/assets/${item.asset.id}`} className="font-semibold text-primary-700 hover:underline dark:text-primary-300">{item.asset.name}<span className="block font-mono text-xs font-normal text-slate-400">{item.asset.asset_code}</span></Link> : '—'}</td><td className="px-3 py-3"><Badge variant={item.action_type === 'Return' ? 'success' : item.action_type === 'Transfer' ? 'warning' : 'info'}>{item.status_label ?? item.action_type}</Badge></td><td className="px-3 py-3 text-slate-500">{fullName(item.from_employee)}</td><td className="px-3 py-3">{fullName(item.to_employee)}<p className="text-xs text-slate-400">{item.department?.name_th ?? item.location ?? ''}</p></td><td className="max-w-xs px-3 py-3 text-slate-500">{item.notes ?? item.condition ?? '—'}</td></tr>)}</tbody></DataTable>}
      {records && <div className="px-4 pb-4"><TablePagination page={records.pagination.page} pageSize={pageSize} totalItems={records.pagination.totalItems} totalPages={records.pagination.totalPages} onPageChange={table.setPage} onPageSizeChange={table.setPageSize} /></div>}
    </Card>
    {formAssetId && <Modal title={borrowForm.data?.title ?? 'แบบฟอร์มการขอยืมทรัพย์สิน'} size="xl" onClose={() => setFormAssetId(undefined)}><div className="p-4">{borrowForm.isLoading && <p role="status">กำลังโหลดแบบฟอร์ม...</p>}{borrowForm.error && <p role="alert" className="text-red-600">{borrowForm.error.message}</p>}{borrowForm.data && <><Button className="mb-3" onClick={() => exportHtmlAsWord(borrowForm.data!.contentHtml, `${borrowForm.data!.assetCode}-borrow`)}>ดาวน์โหลด Word</Button><WordLikeEditor value={borrowForm.data.contentHtml} onChange={() => undefined} fileName={`${borrowForm.data.assetCode}-borrow`} readOnly /></>}</div></Modal>}
    {movementPreset && <Modal title={movementPreset.action === 'return' ? 'รับคืน Asset' : movementPreset.action === 'transfer' ? 'โอนย้าย Asset' : 'บันทึกการยืม Asset'} size="lg" onClose={() => setMovementPreset(null)} testId="asset-borrow-dialog"><MovementModal assets={assetsQuery.data ?? []} employees={employeesQuery.data ?? []} departments={departmentsQuery.data ?? []} initialAction={movementPreset.action} initialAssetId={movementPreset.assetId} onClose={() => setMovementPreset(null)} /></Modal>}
    {detailLoanQuery.data && detailLoanId && <LoanDetailModal loan={detailLoanQuery.data} onClose={() => setDetailLoanId(null)} />}
    {detailLoanQuery.isLoading && detailLoanId && <Modal title="รายละเอียดทะเบียนยืม Asset" size="md" onClose={() => setDetailLoanId(null)}><div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div></Modal>}
  </div>;
}
