import { FileSignature, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { apiFetch } from '../../services/apiClient';

const fieldClass = 'mt-1 min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-primary-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white';

export function FormEvidencePanel({ issueId, issuedAt, canManage, onSaved }: { issueId: string; issuedAt?: string | null; canManage: boolean; onSaved: () => void }) {
  const [partyName, setPartyName] = useState('');
  const [statement, setStatement] = useState('ข้าพเจ้ารับทราบข้อมูลในเอกสารฉบับนี้');
  const [role, setRole] = useState('Approver');
  const [signerName, setSignerName] = useState('');
  const [signatureValue, setSignatureValue] = useState('');
  const [busy, setBusy] = useState<'ack' | 'sign' | null>(null);
  const [message, setMessage] = useState('');
  if (!canManage) return null;

  const acknowledge = async () => {
    if (!partyName.trim() || !statement.trim()) return;
    setBusy('ack'); setMessage('');
    try {
      await apiFetch(`/api/v1/forms/issues/${issueId}/acknowledgement`, { method: 'POST', body: JSON.stringify({ partyType: 'internal', partyName, statement, accepted: true }) });
      setPartyName(''); setMessage('บันทึก Digital acknowledgement แล้ว'); onSaved();
    } catch { /* apiFetch already shows the standard error toast */ } finally { setBusy(null); }
  };
  const sign = async () => {
    if (!signerName.trim() || !signatureValue.trim()) return;
    setBusy('sign'); setMessage('');
    try {
      await apiFetch(`/api/v1/forms/issues/${issueId}/signature`, { method: 'POST', body: JSON.stringify({ role, signerName, signatureType: 'typed', signatureValue }) });
      setSignerName(''); setSignatureValue(''); setMessage('บันทึก Approval Signature Evidence แล้ว'); onSaved();
    } catch { /* apiFetch already shows the standard error toast */ } finally { setBusy(null); }
  };

  return <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2 dark:border-slate-700 dark:bg-slate-800" data-testid="form-evidence-panel">
    <div><div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white"><ShieldCheck className="h-4 w-4 text-primary-600" />Digital acknowledgement</div><p className="mt-1 text-xs text-slate-500">บันทึกผู้รับทราบพร้อม timestamp, IP และ request evidence</p><label className="mt-3 block text-xs font-semibold">ชื่อผู้รับทราบ<input value={partyName} disabled={Boolean(issuedAt)} onChange={(event) => setPartyName(event.target.value)} className={fieldClass} /></label><label className="mt-2 block text-xs font-semibold">ข้อความรับทราบ<textarea rows={2} value={statement} disabled={Boolean(issuedAt)} onChange={(event) => setStatement(event.target.value)} className={fieldClass} /></label><Button size="sm" className="mt-3" isLoading={busy === 'ack'} disabled={Boolean(issuedAt) || !partyName.trim()} onClick={() => void acknowledge()}>รับทราบและบันทึกหลักฐาน</Button></div>
    <div><div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white"><FileSignature className="h-4 w-4 text-primary-600" />Approval Signature Evidence</div><p className="mt-1 text-xs text-slate-500">ลายเซ็นแบบ typed จะถูก hash และล็อกแก้ไขหลังออกเอกสาร</p><label className="mt-3 block text-xs font-semibold">บทบาท<select value={role} disabled={Boolean(issuedAt)} onChange={(event) => setRole(event.target.value)} className={fieldClass}><option>Requester</option><option>IT Owner</option><option>Approver</option><option>Vendor</option></select></label><label className="mt-2 block text-xs font-semibold">ชื่อผู้ลงนาม<input value={signerName} disabled={Boolean(issuedAt)} onChange={(event) => setSignerName(event.target.value)} className={fieldClass} /></label><label className="mt-2 block text-xs font-semibold">ลายเซ็น / ชื่อที่ยืนยัน<input value={signatureValue} disabled={Boolean(issuedAt)} onChange={(event) => setSignatureValue(event.target.value)} className={fieldClass} /></label><Button size="sm" className="mt-3" isLoading={busy === 'sign'} disabled={Boolean(issuedAt) || !signerName.trim() || !signatureValue.trim()} onClick={() => void sign()}>ลงลายเซ็นและบันทึก Evidence</Button></div>
    {message && <p className="md:col-span-2 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
  </section>;
}
