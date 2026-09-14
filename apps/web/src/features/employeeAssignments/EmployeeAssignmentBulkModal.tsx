import { useMutation } from '@tanstack/react-query';
import { Boxes, FileText, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { AssetOption } from '../../types/assets';
import type { EmployeeOption } from '../../types/admin';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

type Mode = 'assign' | 'return';

const fieldClass = 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
const textAreaClass = `${fieldClass} h-auto min-h-20 py-2`;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function employeeLabel(employee: EmployeeOption) {
  return `${employee.employee_code} — ${[employee.prefix_th, employee.first_name_th, employee.last_name_th].filter(Boolean).join(' ')}`;
}

async function attachHandoverDocument(file: File, assignmentIds: string[]) {
  for (const assignmentId of assignmentIds) {
    const form = new FormData();
    form.append('file', file);
    form.append('module', 'employee_assignment');
    form.append('targetTable', 'employee_assignments');
    form.append('targetId', assignmentId);
    const attachment = await apiFetch<{ id: string }>('/api/v1/files', { method: 'POST', body: form });
    await apiFetch(`/api/v1/employee-assignments/${assignmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ handoverDocumentId: attachment.id, handoverDocumentName: file.name }),
    });
  }
}

export function EmployeeAssignmentBulkModal({
  mode,
  employees,
  assets,
  onClose,
  onSaved,
}: {
  mode: Mode;
  employees: EmployeeOption[];
  assets: AssetOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [ownerEmployeeId, setOwnerEmployeeId] = useState('');
  const [custodianEmployeeId, setCustodianEmployeeId] = useState('');
  const [assignedUserEmployeeId, setAssignedUserEmployeeId] = useState('');
  const [managerApprovedBy, setManagerApprovedBy] = useState('');
  const [checkoutDate, setCheckoutDate] = useState(todayIso());
  const [returnDate, setReturnDate] = useState(todayIso());
  const [returnReceiverEmployeeId, setReturnReceiverEmployeeId] = useState('');
  const [accessories, setAccessories] = useState('');
  const [handoverDocument, setHandoverDocument] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeEmployees = employees.filter((employee) => employee.status === 'active');
  const availableAssets = assets.filter((asset) => asset.status === 'พร้อมใช้งาน');

  const mutation = useMutation({
    mutationFn: async () => {
      setErrorMessage(null);
      if (mode === 'assign') {
        const result = await apiFetch<{ assignmentIds?: string[] }>('/api/v1/employee-assignments/bulk-assign', {
          method: 'POST',
          body: JSON.stringify({
            employeeId,
            assetIds,
            checkoutDate,
            ownerEmployeeId: ownerEmployeeId || null,
            custodianEmployeeId: custodianEmployeeId || employeeId,
            assignedUserEmployeeId: assignedUserEmployeeId || employeeId,
            managerApprovedBy,
            accessories: accessories.split('\n').map((item) => item.trim()).filter(Boolean),
            notes: notes || undefined,
          }),
        });
        if (handoverDocument && result.assignmentIds?.length) {
          await attachHandoverDocument(handoverDocument, result.assignmentIds);
        }
        return result;
      }
      return apiFetch('/api/v1/employee-assignments/bulk-return', {
        method: 'POST',
        body: JSON.stringify({
          employeeIds,
          returnDate,
          returnReceiverEmployeeId: returnReceiverEmployeeId || null,
          reason: notes || undefined,
        }),
      });
    },
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'บันทึกรายการไม่สำเร็จ'),
  });

  const toggle = (id: string, selected: string[], setSelected: (next: string[]) => void) => {
    setSelected(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  };

  const canSubmit = mode === 'assign'
    ? Boolean(employeeId && assetIds.length && checkoutDate && managerApprovedBy)
    : Boolean(employeeIds.length && returnDate);

  return (
    <Modal
      title={mode === 'assign' ? 'Bulk Assign — เบิกจ่ายให้พนักงานใหม่' : 'Bulk Return — คืนทรัพย์สินเมื่อพ้นสภาพ'}
      size="xl"
      onClose={onClose}
      closeDisabled={mutation.isPending}
      testId={`employee-assignment-${mode}-dialog`}
      footer={<>
        <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" form={`employee-assignment-${mode}-form`} isLoading={mutation.isPending} disabled={!canSubmit}>
          {mode === 'assign' ? 'บันทึกการเบิกจ่าย' : 'ยืนยันการคืนแบบกลุ่ม'}
        </Button>
      </>}
    >
      <form
        id={`employee-assignment-${mode}-form`}
        className="grid gap-4 p-5 md:grid-cols-2"
        onSubmit={(event) => { event.preventDefault(); if (canSubmit) mutation.mutate(); }}
      >
        <div className="md:col-span-2 rounded-lg border border-primary-200 bg-primary-50/70 p-3 text-sm text-primary-800 dark:border-primary-900/60 dark:bg-primary-950/30 dark:text-primary-200">
          {mode === 'assign'
            ? 'ระบบจะแยก Owner, Custodian และผู้ได้รับมอบหมายใช้งานในแต่ละรายการ และอัปเดต Asset Register ใน transaction เดียวกัน'
            : 'ระบบจะคืนรายการที่ยังครอบครองอยู่ทั้งหมด พร้อมคืน Asset Register และประวัติการเคลื่อนไหวแบบกลุ่ม'}
        </div>

        {mode === 'assign' ? <>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">พนักงานใหม่ *<select className={`${fieldClass} mt-1`} value={employeeId} onChange={(event) => { setEmployeeId(event.target.value); setCustodianEmployeeId(''); setAssignedUserEmployeeId(''); }}>
            <option value="">— เลือกพนักงาน —</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employeeLabel(employee)}</option>)}
          </select></label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">วันที่เบิก *<input type="date" className={`${fieldClass} mt-1`} value={checkoutDate} onChange={(event) => setCheckoutDate(event.target.value)} /></label>

          <div className="md:col-span-2"><p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Asset ที่จะเบิก * ({assetIds.length})</p><div className="grid max-h-44 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700 sm:grid-cols-2">{availableAssets.map((asset) => <label key={asset.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"><input type="checkbox" checked={assetIds.includes(asset.id)} onChange={() => toggle(asset.id, assetIds, setAssetIds)} /><span><span className="font-mono text-xs text-slate-500">{asset.asset_code}</span> · {asset.name}</span></label>)}{availableAssets.length === 0 && <p className="p-3 text-sm text-amber-700">ไม่มี Asset ที่พร้อมใช้งาน</p>}</div></div>

          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Owner<select className={`${fieldClass} mt-1`} value={ownerEmployeeId} onChange={(event) => setOwnerEmployeeId(event.target.value)}><option value="">— องค์กร / ไม่ระบุ —</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employeeLabel(employee)}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Custodian / ผู้ถือครอง<select className={`${fieldClass} mt-1`} value={custodianEmployeeId || employeeId} onChange={(event) => setCustodianEmployeeId(event.target.value)}><option value="">— เลือก —</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employeeLabel(employee)}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้ได้รับมอบหมายใช้งาน<select className={`${fieldClass} mt-1`} value={assignedUserEmployeeId || employeeId} onChange={(event) => setAssignedUserEmployeeId(event.target.value)}><option value="">— เลือก —</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employeeLabel(employee)}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Manager approval *<select className={`${fieldClass} mt-1`} value={managerApprovedBy} onChange={(event) => setManagerApprovedBy(event.target.value)}><option value="">— เลือกผู้อนุมัติ —</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employeeLabel(employee)}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Accessories <span className="font-normal text-slate-400">(รายการละบรรทัด)</span><textarea className={`${textAreaClass} mt-1`} value={accessories} onChange={(event) => setAccessories(event.target.value)} placeholder="Adapter&#10;กระเป๋า" /></label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">เอกสารรับมอบ <span className="font-normal text-slate-400">(PDF/Word/รูปภาพ)</span><span className={`${fieldClass} mt-1 flex items-center gap-2`}><FileText className="h-4 w-4 text-slate-400" /><input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="min-w-0 text-xs" onChange={(event) => setHandoverDocument(event.target.files?.[0] ?? null)} /></span></label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 md:col-span-2">หมายเหตุ<textarea className={`${textAreaClass} mt-1`} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        </> : <>
          <div className="md:col-span-2"><p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">พนักงานที่จะคืนทรัพย์สิน * ({employeeIds.length})</p><div className="grid max-h-52 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700 sm:grid-cols-2">{employees.map((employee) => <label key={employee.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"><input type="checkbox" checked={employeeIds.includes(employee.id)} onChange={() => toggle(employee.id, employeeIds, setEmployeeIds)} /><span>{employeeLabel(employee)}</span></label>)}</div></div>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">วันที่คืน *<input type="date" className={`${fieldClass} mt-1`} value={returnDate} onChange={(event) => setReturnDate(event.target.value)} /></label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">ผู้รับคืน<select className={`${fieldClass} mt-1`} value={returnReceiverEmployeeId} onChange={(event) => setReturnReceiverEmployeeId(event.target.value)}><option value="">— คืนอัตโนมัติ / ยังไม่ระบุ —</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employeeLabel(employee)}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 md:col-span-2">เหตุผล / หมายเหตุ<textarea className={`${textAreaClass} mt-1`} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="เช่น พ้นสภาพ / ส่งคืนฝ่าย IT" /></label>
        </>}

        {errorMessage && <p className="md:col-span-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300" role="alert">{errorMessage}</p>}
        <div className="md:col-span-2 flex items-center gap-2 text-xs text-slate-500"><Boxes className="h-4 w-4" />{mode === 'assign' ? <span>สร้าง {assetIds.length} รายการใน batch เดียว</span> : <><RotateCcw className="h-4 w-4" /> <span>คืนให้ {employeeIds.length} พนักงานในคำสั่งเดียว</span></>}</div>
      </form>
    </Modal>
  );
}
