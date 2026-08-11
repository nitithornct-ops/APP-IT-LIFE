import { AlertTriangle, CheckCircle2, ClipboardCopy, Loader2, Search, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '../services/apiClient';
import { publicTicketApiFetch } from '../services/publicTicketApiClient';

interface TicketCategory { id: string; name: string; response_sla_hours: number | null; resolution_sla_hours: number | null; sla_hours: number | null; }
interface FormData { enabled: boolean; categories: TicketCategory[]; priorities: string[]; privacy: { version: string; summary: string; dpoContact: string }; }
interface SubmitResult { id: string; trackingToken: string; }
interface TrackedTicket {
  ticket: {
    id: string; title: string; description: string; status: string; priority: string;
    resolution: string | null; created_at: string; resolved_at: string | null; closed_at: string | null;
    category: { name: string } | null;
  };
  worklogs: Array<{ action: string; detail: string | null; status_from: string | null; status_to: string | null; created_at: string }>;
}

const CARD = 'w-full max-w-lg rounded-lg bg-white p-6 shadow-sm dark:bg-slate-800';
const BUTTON_PRIMARY = 'flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60';
const BUTTON_SECONDARY = 'flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700';
const INPUT = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
const LABEL = 'mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300';

const SAVED_KEY = 'public_ticket_saved';

function getSavedTickets(): SubmitResult[] {
  try {
    const rows = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as SubmitResult[];
    return Array.isArray(rows) ? rows.slice(0, 20) : [];
  } catch { return []; }
}

function rememberTicket(result: SubmitResult) {
  try {
    const rows = getSavedTickets().filter((r) => r.id !== result.id);
    rows.unshift(result);
    localStorage.setItem(SAVED_KEY, JSON.stringify(rows.slice(0, 20)));
  } catch { /* best-effort only */ }
}

export function PublicTicketPortalPage() {
  const [tab, setTab] = useState<'report' | 'status'>('report');

  return (
    <main className="flex min-h-screen flex-col items-center gap-4 bg-slate-50 p-6 dark:bg-slate-900">
      <div className="mt-4 text-center">
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">แจ้งปัญหา IT</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">LIFE IT Smart Service Center · ไม่ต้องเข้าสู่ระบบ</p>
      </div>

      <div className="flex w-full max-w-lg overflow-hidden rounded-md border border-slate-300 dark:border-slate-600">
        <button
          type="button"
          onClick={() => setTab('report')}
          className={`flex-1 px-4 py-2 text-sm font-medium ${tab === 'report' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
        >
          แจ้งซ่อม
        </button>
        <button
          type="button"
          onClick={() => setTab('status')}
          className={`flex-1 px-4 py-2 text-sm font-medium ${tab === 'status' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
        >
          ติดตามสถานะ
        </button>
      </div>

      {tab === 'report' ? <ReportTab onSubmitted={() => setTab('status')} /> : <StatusTab />}
    </main>
  );
}

function ReportTab({ onSubmitted }: { onSubmitted: () => void }) {
  const [formData, setFormData] = useState<FormData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    void publicTicketApiFetch<FormData>('/api/v1/public/tickets/form-data')
      .then(setFormData)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'โหลดแบบฟอร์มไม่สำเร็จ'));
  }, []);

  if (result) return <SubmittedCard result={result} onTrackStatus={onSubmitted} />;
  if (loadError) return <ErrorCard message={loadError} />;
  if (!formData) {
    return (
      <div className={CARD}>
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
      </div>
    );
  }
  if (!formData.enabled) {
    return (
      <div className={CARD}>
        <p className="text-center text-sm text-amber-700 dark:text-amber-400">
          ขณะนี้ปิดรับการแจ้งซ่อมจากหน้าสาธารณะชั่วคราว กรุณาติดต่อส่วนงาน IT โดยตรง
        </p>
      </div>
    );
  }
  return <ReportForm formData={formData} onSubmitted={(r) => { rememberTicket(r); setResult(r); }} />;
}

function ReportForm({ formData, onSubmitted }: { formData: FormData; onSubmitted: (result: SubmitResult) => void }) {
  const [guestName, setGuestName] = useState('');
  const [requesterPhone, setRequesterPhone] = useState('');
  const [guestDepartment, setGuestDepartment] = useState('');
  const [location, setLocation] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!privacyConsent) {
      setError('กรุณายอมรับประกาศการใช้ข้อมูลส่วนบุคคลก่อนส่ง Ticket');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await publicTicketApiFetch<SubmitResult>('/api/v1/public/tickets', {
        method: 'POST',
        body: JSON.stringify({
          guestName, requesterPhone: requesterPhone || undefined, guestDepartment: guestDepartment || undefined,
          location: location || undefined, categoryId, priority: priority || undefined, title, description,
          privacyConsent: true, website: website || undefined,
        }),
      });
      onSubmitted(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ส่งแจ้งซ่อมไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className={CARD} noValidate>
      <div className="flex flex-col gap-3">
        <div>
          <label className={LABEL} htmlFor="guestName">ชื่อผู้แจ้ง *</label>
          <input id="guestName" className={INPUT} value={guestName} onChange={(e) => setGuestName(e.target.value)} required maxLength={160} placeholder="เช่น สมชาย ใจดี" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL} htmlFor="phone">เบอร์โทร</label>
            <input id="phone" className={INPUT} value={requesterPhone} onChange={(e) => setRequesterPhone(e.target.value)} maxLength={40} placeholder="ติดต่อกลับได้สะดวก" />
          </div>
          <div>
            <label className={LABEL} htmlFor="department">แผนก/หน่วยงาน</label>
            <input id="department" className={INPUT} value={guestDepartment} onChange={(e) => setGuestDepartment(e.target.value)} maxLength={160} />
          </div>
        </div>
        <div>
          <label className={LABEL} htmlFor="category">ประเภทปัญหา *</label>
          <select id="category" className={INPUT} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            <option value="">-- เลือก --</option>
            {formData.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="priority">ความเร่งด่วน</label>
          <select id="priority" className={INPUT} value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">-- เลือก --</option>
            {formData.priorities.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor="location">จุดที่พบปัญหา</label>
          <input id="location" className={INPUT} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={160} placeholder="เช่น อาคาร A ชั้น 3 ห้องบัญชี" />
        </div>
        <div>
          <label className={LABEL} htmlFor="title">สรุปปัญหาสั้น ๆ *</label>
          <input id="title" className={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} placeholder="เช่น เปิดเครื่องไม่ติด มีไฟกระพริบที่หน้าจอ" />
          <p className="mt-1 text-right text-xs text-slate-400">{title.length} / 120</p>
        </div>
        <div>
          <label className={LABEL} htmlFor="description">รายละเอียดเพิ่มเติม *</label>
          <textarea id="description" className={INPUT} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={1500} placeholder="อธิบายว่าเกิดอะไรขึ้น เริ่มเป็นเมื่อไร และลองแก้อะไรไปแล้ว" />
          <p className="mt-1 text-right text-xs text-slate-400">{description.length} / 1500</p>
        </div>

        {/* Honeypot — hidden from real visitors via CSS only (screen readers/tab order untouched matters less than bots not seeing it rendered) */}
        <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="absolute left-[-9999px] opacity-0" aria-hidden="true" />

        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
          <p className="mb-1 font-semibold">ประกาศการใช้ข้อมูลส่วนบุคคล</p>
          <p>{formData.privacy.summary}</p>
          <p className="mt-1">เวอร์ชัน {formData.privacy.version} · ติดต่อ {formData.privacy.dpoContact}</p>
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} className="mt-0.5" />
          ข้าพเจ้าอ่านและยอมรับการใช้ข้อมูลเพื่อรับเรื่อง แจ้งสถานะ และดำเนินการแจ้งซ่อม
        </label>

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" disabled={submitting} className={BUTTON_PRIMARY}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          ส่งแจ้งซ่อม
        </button>
      </div>
    </form>
  );
}

function SubmittedCard({ result, onTrackStatus }: { result: SubmitResult; onTrackStatus: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(result.trackingToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard not available — user can still select the text manually */ }
  }

  return (
    <div className={CARD}>
      <div className="flex flex-col items-center gap-2 text-center">
        <CheckCircle2 className="h-10 w-10 text-green-600" aria-hidden="true" />
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">ส่งแจ้งซ่อมสำเร็จ</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">กรุณาบันทึกรหัสติดตามนี้ไว้ — ใช้เช็คสถานะภายหลังได้ (ระบบไม่แสดงรหัสนี้ซ้ำอีก)</p>
      </div>
      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
        <p className="text-xs text-slate-500 dark:text-slate-400">เลข Ticket</p>
        <p className="break-all font-mono text-sm text-slate-800 dark:text-slate-100">{result.id}</p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">รหัสติดตาม</p>
        <div className="flex items-center gap-2">
          <p className="break-all font-mono text-sm text-slate-800 dark:text-slate-100">{result.trackingToken}</p>
          <button type="button" onClick={() => void copyToken()} className="shrink-0 text-slate-400 hover:text-blue-600" aria-label="คัดลอกรหัสติดตาม">
            <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {copied && <p className="mt-1 text-xs text-green-600">คัดลอกแล้ว</p>}
      </div>
      <button type="button" onClick={onTrackStatus} className={`${BUTTON_SECONDARY} mt-4`}>
        <Search className="h-4 w-4" aria-hidden="true" /> ไปที่หน้าติดตามสถานะ
      </button>
    </div>
  );
}

function StatusTab() {
  const [saved, setSaved] = useState<SubmitResult[]>([]);
  const [ticketId, setTicketId] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<TrackedTicket | null>(null);

  useEffect(() => { setSaved(getSavedTickets()); }, []);

  async function lookup(id: string, tok: string) {
    setLoading(true);
    setError(null);
    setDetail(null);
    try {
      const data = await publicTicketApiFetch<TrackedTicket>(`/api/v1/public/tickets/${id}?token=${encodeURIComponent(tok)}`);
      setDetail(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ค้นหาไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  if (detail) {
    return (
      <div className={CARD}>
        <button type="button" onClick={() => setDetail(null)} className="mb-3 text-sm text-slate-500 hover:underline">
          &larr; กลับ
        </button>
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{detail.ticket.title}</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          สถานะ: {detail.ticket.status} · {detail.ticket.category?.name ?? '-'} · ความเร่งด่วน {detail.ticket.priority}
        </p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{detail.ticket.description}</p>
        {detail.ticket.resolution && (
          <p className="mt-2 rounded-md bg-slate-50 p-2 text-sm text-slate-600 dark:bg-slate-700 dark:text-slate-300">ผลดำเนินการ: {detail.ticket.resolution}</p>
        )}
        <ul className="mt-3 flex flex-col gap-1 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {detail.worklogs.map((log, index) => (
            <li key={index}>{log.action}{log.detail ? ` — ${log.detail}` : ''}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className={CARD}>
      {saved.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Ticket ที่เคยแจ้งจากเครื่องนี้</p>
          <ul className="flex flex-col gap-1">
            {saved.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => void lookup(row.id, row.trackingToken)}
                  className="w-full truncate rounded-md border border-slate-200 px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {row.id}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={(event) => { event.preventDefault(); void lookup(ticketId, token); }} className="flex flex-col gap-3">
        <div>
          <label className={LABEL} htmlFor="ticketId">เลข Ticket</label>
          <input id="ticketId" className={INPUT} value={ticketId} onChange={(e) => setTicketId(e.target.value)} required />
        </div>
        <div>
          <label className={LABEL} htmlFor="token">รหัสติดตาม</label>
          <input id="token" className={INPUT} value={token} onChange={(e) => setToken(e.target.value)} required />
        </div>
        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        <button type="submit" disabled={loading} className={BUTTON_PRIMARY}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
          ตรวจสอบสถานะ
        </button>
      </form>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
    </div>
  );
}
