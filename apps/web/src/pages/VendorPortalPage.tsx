import { ArrowLeft, Building2, CheckCircle2, ClipboardList, FileSignature, Loader2, LogOut, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PublicBrand } from '../components/PublicBrand';
import { Button } from '../components/ui/Button';
import { RequesterSignatureInput } from '../features/tickets/RequesterSignatureInput';
import { ApiError } from '../services/apiClient';
import { clearVendorSessionToken, getVendorSessionToken, setVendorSessionToken, vendorPortalApiFetch } from '../services/vendorPortalApiClient';
import type { VendorPortalProfile, VendorPortalTicket, VendorPortalTicketDetail } from '../types/vendorPortal';
import { formatThaiDate } from '../utils/date';

const fieldClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100';
const emptyWorkForm = {
  vendorIssueNo: '', slaCategory: 'Minor Case', receivedAt: '', workStartedAt: '', workCompletedAt: '',
  receivedDuration: '', workaroundDuration: '', analysisDuration: '', resolutionDuration: '',
  rootCause: '', workaround: '', resolution: '', prevention: '', partsUsed: '', testResult: '', notes: '',
  assessorName: '', assessorPosition: '', confirmed: false,
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

function reviewLabel(status?: string | null): { text: string; className: string } {
  if (status === 'Accepted') return { text: 'IT ตรวจรับแล้ว', className: 'bg-emerald-100 text-emerald-800' };
  if (status === 'Revision Requested') return { text: 'ขอให้แก้ไข', className: 'bg-rose-100 text-rose-800' };
  if (status === 'Submitted') return { text: 'รอ IT ตรวจรับ', className: 'bg-amber-100 text-amber-800' };
  return { text: 'รอบริษัทดำเนินการ', className: 'bg-slate-100 text-slate-600' };
}

export function VendorPortalPage() {
  const [profile, setProfile] = useState<VendorPortalProfile | null>(null);
  const [tickets, setTickets] = useState<VendorPortalTicket[]>([]);
  const [detail, setDetail] = useState<VendorPortalTicketDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(getVendorSessionToken()));
  const [error, setError] = useState('');
  const [login, setLogin] = useState({ vendorCode: '', email: '', password: '' });
  const [loggingIn, setLoggingIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [work, setWork] = useState(emptyWorkForm);
  const [signature, setSignature] = useState<File | null>(null);

  async function loadTickets() {
    const rows = await vendorPortalApiFetch<VendorPortalTicket[]>('/api/v1/vendor-portal/tickets');
    setTickets(rows);
  }

  useEffect(() => {
    if (!getVendorSessionToken()) { setLoading(false); return; }
    let cancelled = false;
    Promise.all([
      vendorPortalApiFetch<VendorPortalProfile>('/api/v1/vendor-portal/me'),
      vendorPortalApiFetch<VendorPortalTicket[]>('/api/v1/vendor-portal/tickets'),
    ]).then(([nextProfile, rows]) => {
      if (cancelled) return;
      setProfile(nextProfile);
      setTickets(rows);
    }).catch((reason) => {
      if (cancelled) return;
      clearVendorSessionToken();
      setError(errorMessage(reason, 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่'));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function submitLogin() {
    setLoggingIn(true); setError('');
    try {
      const result = await vendorPortalApiFetch<{ token: string; profile: VendorPortalProfile }>('/api/v1/vendor-portal/login', {
        method: 'POST', body: JSON.stringify(login),
      });
      setVendorSessionToken(result.token);
      setProfile(result.profile);
      await loadTickets();
    } catch (reason) {
      setError(errorMessage(reason, 'เข้าสู่ระบบไม่สำเร็จ'));
    } finally { setLoggingIn(false); }
  }

  async function openTicket(ticketId: string) {
    setLoading(true); setError('');
    try {
      const next = await vendorPortalApiFetch<VendorPortalTicketDetail>(`/api/v1/vendor-portal/tickets/${ticketId}`);
      setDetail(next);
      setWork({
        ...emptyWorkForm,
        vendorIssueNo: next.ticket.outsource_issue_no ?? '',
        assessorName: profile?.fullName ?? '',
        assessorPosition: profile?.position ?? '',
      });
      setSignature(null);
    } catch (reason) { setError(errorMessage(reason, 'โหลดรายละเอียดงานไม่สำเร็จ')); }
    finally { setLoading(false); }
  }

  async function submitWork() {
    if (!detail || !signature) return;
    setSubmitting(true); setError('');
    try {
      const body = new FormData();
      body.set('file', signature);
      body.set('payload', JSON.stringify(work));
      await vendorPortalApiFetch(`/api/v1/vendor-portal/tickets/${detail.ticket.id}/submit`, { method: 'POST', body });
      await Promise.all([loadTickets(), openTicket(detail.ticket.id)]);
    } catch (reason) { setError(errorMessage(reason, 'ส่งผลการดำเนินงานไม่สำเร็จ')); }
    finally { setSubmitting(false); }
  }

  async function logout() {
    try { await vendorPortalApiFetch('/api/v1/vendor-portal/logout', { method: 'POST', body: '{}' }); } catch { /* local logout still applies */ }
    clearVendorSessionToken(); setProfile(null); setTickets([]); setDetail(null); setError('');
  }

  if (loading && !profile) return <main className="public-portal min-h-screen bg-slate-50"><PublicBrand /><div className="flex justify-center py-24" role="status"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /></div></main>;

  if (!profile) return <main className="public-portal min-h-screen bg-slate-50 px-4 py-8"><div className="mx-auto max-w-md"><PublicBrand />
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-100 text-primary-700"><Building2 className="h-6 w-6" /></div>
      <h1 className="mt-4 text-xl font-extrabold text-slate-900">Outsource Portal</h1>
      <p className="mt-1 text-sm text-slate-500">เข้าสู่ระบบเพื่อดูเฉพาะงานแจ้งซ่อมที่ส่งต่อให้บริษัทของท่าน</p>
      <form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); void submitLogin(); }}>
        <label className="block text-sm font-semibold">รหัสบริษัท<input required autoComplete="organization" value={login.vendorCode} onChange={(e) => setLogin((current) => ({ ...current, vendorCode: e.target.value.toUpperCase() }))} className={fieldClass} placeholder="VND-..." /></label>
        <label className="block text-sm font-semibold">อีเมลผู้ติดต่อ<input required type="email" autoComplete="username" value={login.email} onChange={(e) => setLogin((current) => ({ ...current, email: e.target.value }))} className={fieldClass} /></label>
        <label className="block text-sm font-semibold">รหัสผ่าน<input required type="password" autoComplete="current-password" value={login.password} onChange={(e) => setLogin((current) => ({ ...current, password: e.target.value }))} className={fieldClass} /></label>
        {error && <p role="alert" className="text-sm font-semibold text-rose-600">{error}</p>}
        <Button type="submit" className="w-full" isLoading={loggingIn}><ShieldCheck className="h-4 w-4" />เข้าสู่ระบบบริษัท</Button>
      </form>
    </section>
  </div></main>;

  if (detail) {
    const submission = detail.submission;
    const canSubmit = !submission || submission.review_status === 'Revision Requested';
    const response = submission?.response ?? {};
    return <main className="public-portal min-h-screen bg-slate-50 px-4 py-6"><div className="mx-auto max-w-4xl">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={() => setDetail(null)} className="inline-flex items-center gap-1 text-sm font-bold text-primary-700"><ArrowLeft className="h-4 w-4" />กลับรายการงาน</button><button type="button" onClick={() => void logout()} className="inline-flex items-center gap-1 text-xs text-slate-500"><LogOut className="h-4 w-4" />ออกจากระบบ</button></header>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="font-mono text-xs font-bold text-primary-700">{detail.ticket.ticket_no}</p><h1 className="mt-1 text-xl font-extrabold text-slate-900">{detail.ticket.title}</h1><div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500"><span>{detail.ticket.ticket_categories?.name ?? 'งาน IT'}</span><span>•</span><span>ความเร่งด่วน {detail.ticket.priority}</span>{detail.ticket.location && <><span>•</span><span>{detail.ticket.location}</span></>}</div><div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700 whitespace-pre-wrap">{detail.ticket.description}</div></section>
      {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}
      {!canSubmit && submission ? <section className="mt-4 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm"><p className="flex items-center gap-2 font-bold text-emerald-800"><CheckCircle2 className="h-5 w-5" />บริษัทส่งผลการดำเนินงานและลงนามแล้ว</p><p className="mt-2 text-sm text-slate-600">ฉบับที่ {submission.revision} · ส่งเมื่อ {formatThaiDate(submission.submitted_at, 'd MMM yyyy HH:mm')}</p><span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-bold ${reviewLabel(submission.review_status).className}`}>{reviewLabel(submission.review_status).text}</span>{submission.signature_url && <div className="mt-4 rounded-xl border bg-slate-50 p-3 text-center"><img className="mx-auto max-h-28" src={submission.signature_url} alt="ลายเซ็นบริษัท" /></div>}<dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-bold">สาเหตุ</dt><dd className="mt-1 whitespace-pre-wrap text-slate-600">{String(response.rootCause ?? '—')}</dd></div><div><dt className="font-bold">วิธีแก้ไข</dt><dd className="mt-1 whitespace-pre-wrap text-slate-600">{String(response.resolution ?? '—')}</dd></div><div className="sm:col-span-2"><dt className="font-bold">ผลการทดสอบ</dt><dd className="mt-1 whitespace-pre-wrap text-slate-600">{String(response.testResult ?? '—')}</dd></div></dl></section> : <section className="mt-4 rounded-2xl border border-primary-200 bg-white p-5 shadow-sm">
        <div className="mb-4"><p className="flex items-center gap-2 text-lg font-extrabold text-slate-900"><FileSignature className="h-5 w-5 text-primary-700" />ส่วนที่ 3: การแก้ไขปัญหาโดยผู้รับจ้าง</p><p className="mt-1 text-sm text-slate-500">บริษัทแก้ไขได้เฉพาะข้อมูลในส่วนนี้ เมื่อลงนามแล้วระบบจะส่งให้ IT ตรวจรับ</p>{submission?.review_note && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">สิ่งที่ IT ขอให้แก้ไข: {submission.review_note}</p>}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold">Vendor Ticket No.<input maxLength={120} value={work.vendorIssueNo} onChange={(e) => setWork((v) => ({ ...v, vendorIssueNo: e.target.value }))} className={fieldClass} /></label>
          <label className="text-sm font-semibold">SLA Category<select value={work.slaCategory} onChange={(e) => setWork((v) => ({ ...v, slaCategory: e.target.value }))} className={fieldClass}><option>Emergency Case</option><option>Minor Case</option><option>อื่น ๆ</option></select></label>
          <label className="text-sm font-semibold">วัน/เวลารับงาน<input type="datetime-local" value={work.receivedAt} onChange={(e) => setWork((v) => ({ ...v, receivedAt: e.target.value }))} className={fieldClass} /></label>
          <label className="text-sm font-semibold">วัน/เวลาเริ่มดำเนินงาน<input type="datetime-local" value={work.workStartedAt} onChange={(e) => setWork((v) => ({ ...v, workStartedAt: e.target.value }))} className={fieldClass} /></label>
          <label className="text-sm font-semibold">วัน/เวลาเสร็จงาน<input type="datetime-local" value={work.workCompletedAt} onChange={(e) => setWork((v) => ({ ...v, workCompletedAt: e.target.value }))} className={fieldClass} /></label>
          <label className="text-sm font-semibold">ระยะเวลารับแจ้งจริง<input maxLength={160} value={work.receivedDuration} onChange={(e) => setWork((v) => ({ ...v, receivedDuration: e.target.value }))} className={fieldClass} placeholder="เช่น 30 นาที" /></label>
          <label className="text-sm font-semibold">ระยะเวลา Workaround<input maxLength={160} value={work.workaroundDuration} onChange={(e) => setWork((v) => ({ ...v, workaroundDuration: e.target.value }))} className={fieldClass} placeholder="เช่น 2 ชั่วโมง" /></label>
          <label className="text-sm font-semibold">ระยะเวลาวิเคราะห์สาเหตุ<input maxLength={160} value={work.analysisDuration} onChange={(e) => setWork((v) => ({ ...v, analysisDuration: e.target.value }))} className={fieldClass} placeholder="เช่น 1 วัน" /></label>
          <label className="text-sm font-semibold">ระยะเวลาแก้ไขถาวร<input maxLength={160} value={work.resolutionDuration} onChange={(e) => setWork((v) => ({ ...v, resolutionDuration: e.target.value }))} className={fieldClass} placeholder="เช่น 2 วัน" /></label>
          <label className="text-sm font-semibold sm:col-span-2">สาเหตุของปัญหา<textarea required rows={3} maxLength={2000} value={work.rootCause} onChange={(e) => setWork((v) => ({ ...v, rootCause: e.target.value }))} className={fieldClass} /></label>
          <label className="text-sm font-semibold sm:col-span-2">การแก้ไขเบื้องต้น / Workaround<textarea rows={3} maxLength={2000} value={work.workaround} onChange={(e) => setWork((v) => ({ ...v, workaround: e.target.value }))} className={fieldClass} /></label>
          <label className="text-sm font-semibold sm:col-span-2">วิธีแก้ไขถาวรและผลการดำเนินงาน<textarea required rows={4} maxLength={3000} value={work.resolution} onChange={(e) => setWork((v) => ({ ...v, resolution: e.target.value }))} className={fieldClass} /></label>
          <label className="text-sm font-semibold sm:col-span-2">แนวทางป้องกันไม่ให้เกิดซ้ำ<textarea rows={3} maxLength={2000} value={work.prevention} onChange={(e) => setWork((v) => ({ ...v, prevention: e.target.value }))} className={fieldClass} /></label>
          <label className="text-sm font-semibold sm:col-span-2">อะไหล่หรืออุปกรณ์ที่เปลี่ยน<textarea rows={2} maxLength={2000} value={work.partsUsed} onChange={(e) => setWork((v) => ({ ...v, partsUsed: e.target.value }))} className={fieldClass} /></label>
          <label className="text-sm font-semibold sm:col-span-2">ผลการทดสอบหลังแก้ไข<textarea required rows={3} maxLength={2000} value={work.testResult} onChange={(e) => setWork((v) => ({ ...v, testResult: e.target.value }))} className={fieldClass} /></label>
          <label className="text-sm font-semibold sm:col-span-2">หมายเหตุเพิ่มเติม<textarea rows={2} maxLength={2000} value={work.notes} onChange={(e) => setWork((v) => ({ ...v, notes: e.target.value }))} className={fieldClass} /></label>
          <label className="text-sm font-semibold">ชื่อ–นามสกุลผู้ลงนาม<input required maxLength={160} value={work.assessorName} onChange={(e) => setWork((v) => ({ ...v, assessorName: e.target.value }))} className={fieldClass} /></label>
          <label className="text-sm font-semibold">ตำแหน่ง<input maxLength={160} value={work.assessorPosition} onChange={(e) => setWork((v) => ({ ...v, assessorPosition: e.target.value }))} className={fieldClass} /></label>
        </div>
        <div className="mt-4"><RequesterSignatureInput onChange={setSignature} disabled={submitting} title="ลายเซ็นผู้ปฏิบัติงานของบริษัท" description="ต้องลงลายเซ็นก่อนส่งให้ IT ตรวจรับ" inputLabel="บริษัท" /></div>
        <label className="mt-4 flex items-start gap-2 text-sm text-slate-600"><input type="checkbox" checked={work.confirmed} onChange={(e) => setWork((v) => ({ ...v, confirmed: e.target.checked }))} className="mt-1 h-4 w-4" /><span>ข้าพเจ้ายืนยันว่าข้อมูลผลการดำเนินงานถูกต้องและเป็นผู้มีอำนาจลงนามในงานนี้</span></label>
        <Button className="mt-4 w-full" disabled={!signature || !work.confirmed || !work.rootCause.trim() || !work.resolution.trim() || !work.testResult.trim()} isLoading={submitting} onClick={() => void submitWork()}><Send className="h-4 w-4" />ส่งผลการดำเนินงานและลงนาม</Button>
      </section>}
    </div></main>;
  }

  return <main className="public-portal min-h-screen bg-slate-50 px-4 py-6"><div className="mx-auto max-w-5xl">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#0B1B36] p-5 text-white"><div><p className="text-xs font-bold text-primary-300">{profile.vendorCode}</p><h1 className="mt-1 text-xl font-extrabold">{profile.vendorName}</h1><p className="mt-1 text-xs text-white/60">{profile.fullName}{profile.position ? ` · ${profile.position}` : ''}</p></div><div className="flex gap-2"><button type="button" onClick={() => void loadTickets()} className="rounded-lg bg-white/10 p-2" aria-label="โหลดรายการใหม่"><RefreshCw className="h-4 w-4" /></button><button type="button" onClick={() => void logout()} className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-xs font-bold"><LogOut className="h-4 w-4" />ออกจากระบบ</button></div></header>
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-2"><div><h2 className="flex items-center gap-2 font-extrabold text-slate-900"><ClipboardList className="h-5 w-5 text-primary-700" />งานแจ้งซ่อมที่ส่งต่อ Outsource</h2><p className="mt-1 text-xs text-slate-500">แสดงเฉพาะงานที่กำลังส่งต่อให้บริษัทของท่าน</p></div><span className="rounded-full bg-primary-100 px-3 py-1 text-sm font-bold text-primary-800">{tickets.length} งาน</span></div>
      {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}
      {tickets.length === 0 ? <div className="py-16 text-center text-slate-400"><ClipboardList className="mx-auto h-10 w-10" /><p className="mt-3 text-sm">ยังไม่มีงานที่ส่งต่อให้บริษัท</p></div> : <div className="mt-4 grid gap-3">{tickets.map((ticket) => { const review = reviewLabel(ticket.latest_submission?.review_status); return <button type="button" key={ticket.id} onClick={() => void openTicket(ticket.id)} className="rounded-xl border border-slate-200 p-4 text-left transition hover:border-primary-300 hover:bg-primary-50/40"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-mono text-xs font-bold text-primary-700">{ticket.ticket_no}</p><p className="mt-1 font-bold text-slate-900">{ticket.title}</p><p className="mt-1 text-xs text-slate-500">{ticket.ticket_categories?.name ?? 'งาน IT'} · ส่งต่อเมื่อ {ticket.outsource_sent_at ? formatThaiDate(ticket.outsource_sent_at, 'd MMM yyyy HH:mm') : '—'}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${review.className}`}>{review.text}</span></div></button>; })}</div>}
    </section>
  </div></main>;
}
