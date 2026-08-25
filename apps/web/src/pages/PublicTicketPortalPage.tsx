import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleHelp,
  ClipboardCopy,
  Clock3,
  FileImage,
  LifeBuoy,
  Loader2,
  MessageCircle,
  Search,
  Send,
  ShieldCheck,
  TicketCheck,
  UserRound,
  Wrench,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicBrand } from '../components/PublicBrand';
import { Badge } from '../components/ui/Badge';
import { ApiError } from '../services/apiClient';
import { getLineSessionToken, lineApiFetch } from '../services/lineApiClient';
import { publicTicketApiFetch } from '../services/publicTicketApiClient';

interface TicketCategory {
  id: string;
  name: string;
  response_sla_hours: number | null;
  resolution_sla_hours: number | null;
  sla_hours: number | null;
}

interface FormData {
  enabled: boolean;
  categories: TicketCategory[];
  priorities: string[];
  privacy: { version: string; summary: string; dpoContact: string };
}

interface SubmitResult {
  id: string;
  ticketNo?: string;
  trackingToken: string;
  attachmentCount?: number;
  attachmentWarning?: string;
}
interface TrackedTicket {
  ticket: {
    id: string;
    ticket_no: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    resolution: string | null;
    created_at: string;
    resolved_at: string | null;
    closed_at: string | null;
    category: { name: string } | null;
  };
  worklogs: Array<{
    action: string;
    detail: string | null;
    status_from: string | null;
    status_to: string | null;
    created_at: string;
  }>;
  attachments: Array<{
    id: string;
    original_filename: string;
    mime_type: string;
    size_bytes: number;
    signed_url: string | null;
  }>;
}

interface LineBootstrap {
  authenticated: boolean;
  profile: {
    fullName: string;
    linkStatus: string;
  } | null;
}

interface LineTicketSummary {
  id: string;
  ticket_no: string;
  title: string;
  priority: string;
  status: string;
  created_at: string;
  category: { name: string } | null;
}

interface KnowledgeData {
  articles: Array<{
    id: string;
    article_code: string;
    title: string;
    category: string | null;
    symptom: string | null;
    solution: string;
    tags: string[];
    views: number;
    helpful: number;
  }>;
  categories: Array<{ id: string; name: string }>;
}

type PortalTab = 'report' | 'knowledge' | 'status';

const SAVED_KEY = 'public_ticket_saved';
const INPUT = 'public-field w-full px-3 py-2.5 text-sm placeholder:text-slate-400 transition focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50';
const LABEL = 'mb-1.5 block text-sm font-medium text-slate-700';
const PRIMARY_BUTTON = 'public-primary-button inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60';
const CARD = 'public-sheet';
const DEFAULT_PRIVACY = {
  version: '2026-08-31',
  summary: 'ระบบใช้ข้อมูลผู้แจ้งเพื่อรับเรื่อง ติดต่อกลับ ดำเนินการแจ้งซ่อม และแจ้งสถานะ Ticket เท่านั้น',
  dpoContact: 'DPO / ส่วนงาน IT',
};
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

function getSavedTickets(): SubmitResult[] {
  try {
    const rows = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as SubmitResult[];
    return Array.isArray(rows) ? rows.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function rememberTicket(result: SubmitResult) {
  try {
    const rows = getSavedTickets().filter((row) => row.id !== result.id);
    rows.unshift(result);
    localStorage.setItem(SAVED_KEY, JSON.stringify(rows.slice(0, 20)));
  } catch {
    // Saving a shortcut is best-effort only. The tracking token is still shown after submit.
  }
}

export function PublicTicketPortalPage() {
  const [tab, setTab] = useState<PortalTab>('report');

  return (
    <main className="life-public min-h-screen text-slate-800">
      <div className="mx-auto grid min-h-screen w-full max-w-[1440px] gap-4 p-3 sm:p-4 lg:grid-cols-[250px_minmax(0,1fr)] lg:p-5">
        <PortalSidebar tab={tab} onChange={setTab} />

        <div className="min-w-0">
          <LineBanner />
          <header className="public-portal-hero mb-5 mt-5 flex items-start gap-3 rounded-large p-5 sm:p-6">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
              {tab === 'report' ? <Wrench className="h-5 w-5" aria-hidden="true" /> : tab === 'knowledge' ? <CircleHelp className="h-5 w-5" aria-hidden="true" /> : <TicketCheck className="h-5 w-5" aria-hidden="true" />}
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-accent-300">LIFE IT Support</p>
              <h1 className="text-xl font-bold text-white">
                {tab === 'report' ? 'แจ้งซ่อม' : tab === 'knowledge' ? 'วิธีแก้เบื้องต้น' : 'ติดตามสถานะ'}
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-primary-100">
                {tab === 'report' ? 'แจ้งอาการหรือปัญหากับทีม IT เราจะรับเรื่องและติดตามจนจบงาน' : tab === 'knowledge' ? 'ค้นหาวิธีแก้ปัญหาที่พบบ่อยก่อนส่งแจ้งซ่อม' : 'ตรวจสอบความคืบหน้าของรายการที่เคยแจ้งไว้'}
              </p>
            </div>
          </header>

          {tab === 'report' && <ReportTab onSubmitted={() => setTab('status')} />}
          {tab === 'knowledge' && <KnowledgeTab />}
          {tab === 'status' && <StatusTab />}
        </div>
      </div>
    </main>
  );
}

function PortalSidebar({ tab, onChange }: { tab: PortalTab; onChange: (tab: PortalTab) => void }) {
  const navItems: Array<{ key: PortalTab; label: string; icon: typeof Wrench }> = [
    { key: 'report', label: 'แจ้งซ่อม', icon: Wrench },
    { key: 'knowledge', label: 'วิธีแก้เบื้องต้น', icon: CircleHelp },
    { key: 'status', label: 'ติดตามสถานะ', icon: TicketCheck },
  ];

  return (
    <aside className="public-sheet flex flex-col p-4 lg:sticky lg:top-5 lg:h-[calc(100vh-2.5rem)]">
      <div className="flex items-center gap-3 border-b border-slate-100 pb-4 lg:border-0 lg:pb-5">
        <PublicBrand subtitle="IT Helpdesk" />
      </div>

      <p className="mt-4 hidden px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 lg:block">เมนูหลัก</p>
      <nav className="mt-3 grid grid-cols-3 gap-2 lg:flex lg:flex-col" aria-label="เมนูแจ้งซ่อม">
        {navItems.map((item) => {
          const Icon = item.icon;
          const selected = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              aria-current={selected ? 'page' : undefined}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-2 py-2 text-xs font-medium transition lg:justify-start lg:px-3 lg:text-sm ${selected ? 'bg-primary-100 font-semibold text-primary-800' : 'text-slate-600 hover:bg-primary-50 hover:text-primary-800'}`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <section className="mt-6 hidden rounded-xl border border-primary-100 bg-primary-50/60 p-4 lg:block" aria-labelledby="steps-title">
        <h2 id="steps-title" className="text-sm font-bold text-slate-800">แจ้งปัญหาได้ใน 3 ขั้นตอน</h2>
        <ol className="mt-3 space-y-3">
          {[
            'เลือกประเภทและอธิบายอาการ',
            'ส่งคำขอและรับเลข Ticket',
            'ติดตามความคืบหน้าได้ทุกเวลา',
          ].map((step, index) => (
            <li key={step} className="flex gap-2 text-xs leading-5 text-slate-600">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary-200 bg-white text-[10px] font-bold text-primary-700">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-auto hidden space-y-2 pt-5 text-[11px] text-slate-500 lg:block">
        <p className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> ข้อมูลของคุณปลอดภัย</p>
        <p className="flex items-center gap-2"><LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" /> ทีมงานพร้อมให้บริการ</p>
      </div>
    </aside>
  );
}

function LineBanner() {
  return (
    <div className="public-sheet flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="public-line-button flex h-[42px] w-[42px] shrink-0 items-center justify-center">
          <MessageCircle className="h-5 w-5 fill-current" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800">เข้าสู่ระบบด้วย LINE</p>
          <p className="text-xs text-slate-500">แจ้งซ่อมและติดตามสถานะได้สะดวก พร้อมรับการแจ้งเตือน</p>
        </div>
      </div>
      <Link to="/line" className="public-line-button inline-flex shrink-0 items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold transition">
        <MessageCircle className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> LINE Login
      </Link>
    </div>
  );
}

function ReportTab({ onSubmitted }: { onSubmitted: () => void }) {
  const [formData, setFormData] = useState<FormData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  useEffect(() => {
    void publicTicketApiFetch<FormData>('/api/v1/public/tickets/form-data')
      .then(setFormData)
      .catch((error) => setLoadError(error instanceof ApiError ? error.message : 'โหลดข้อมูลแบบฟอร์มไม่สำเร็จ'));
  }, []);

  if (result) return <SubmittedCard result={result} onTrackStatus={onSubmitted} />;
  if (formData && !formData.enabled) {
    return <ErrorCard message="ขณะนี้ปิดรับการแจ้งซ่อมจากหน้าสาธารณะ กรุณาติดต่อส่วนงาน IT โดยตรง" />;
  }

  return (
    <ReportForm
      formData={formData ?? { enabled: true, categories: [], priorities: ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'], privacy: DEFAULT_PRIVACY }}
      loading={!formData && !loadError}
      loadError={loadError}
      onSubmitted={(submitted) => {
        rememberTicket(submitted);
        setResult(submitted);
      }}
    />
  );
}

function ReportForm({ formData, loading, loadError, onSubmitted }: { formData: FormData; loading: boolean; loadError: string | null; onSubmitted: (result: SubmitResult) => void }) {
  const [guestName, setGuestName] = useState('');
  const [requesterPhone, setRequesterPhone] = useState('');
  const [guestDepartment, setGuestDepartment] = useState('');
  const [location, setLocation] = useState('');
  const [assetCode, setAssetCode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectAttachments(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (selected.length === 0) return;
    if (attachments.length + selected.length > MAX_ATTACHMENTS) {
      setError(`แนบได้สูงสุด ${MAX_ATTACHMENTS} ไฟล์ต่อ Ticket`);
      return;
    }
    const invalidType = selected.find((file) => !ATTACHMENT_TYPES.includes(file.type));
    if (invalidType) {
      setError(`ไฟล์ ${invalidType.name} ไม่รองรับ — เลือกได้เฉพาะ JPG, PNG, GIF, WebP หรือ PDF`);
      return;
    }
    const oversized = selected.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (oversized) {
      setError(`ไฟล์ ${oversized.name} มีขนาดเกิน 10 MB`);
      return;
    }
    setAttachments((current) => [...current, ...selected]);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (loadError || formData.categories.length === 0) {
      setError('ยังโหลดประเภทปัญหาไม่สำเร็จ กรุณาลองรีเฟรชหน้าอีกครั้ง');
      return;
    }
    if (!privacyConsent) {
      setError('กรุณายอมรับประกาศการใช้ข้อมูลส่วนบุคคลก่อนส่ง Ticket');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const submitted = await publicTicketApiFetch<SubmitResult>('/api/v1/public/tickets', {
        method: 'POST',
        body: JSON.stringify({
          guestName,
          requesterPhone: requesterPhone || undefined,
          guestDepartment: guestDepartment || undefined,
          location: location || undefined,
          assetCode: assetCode || undefined,
          categoryId,
          priority: priority || undefined,
          title,
          description,
          privacyConsent: true,
          website: website || undefined,
        }),
      });
      let attachmentCount = 0;
      let attachmentWarning: string | undefined;
      for (const file of attachments) {
        try {
          const uploadBody = new window.FormData();
          uploadBody.append('file', file);
          await publicTicketApiFetch(`/api/v1/public/tickets/${submitted.id}/attachments`, {
            method: 'POST',
            headers: { 'x-tracking-token': submitted.trackingToken },
            body: uploadBody,
          });
          attachmentCount += 1;
        } catch (uploadError) {
          attachmentWarning = uploadError instanceof ApiError
            ? `สร้าง Ticket แล้ว แต่อัปโหลดไฟล์บางรายการไม่สำเร็จ: ${uploadError.message}`
            : 'สร้าง Ticket แล้ว แต่อัปโหลดไฟล์บางรายการไม่สำเร็จ';
          break;
        }
      }
      onSubmitted({ ...submitted, attachmentCount, attachmentWarning });
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : 'ส่งแจ้งซ่อมไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className={`${CARD} overflow-hidden`} noValidate>
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900">แจ้งปัญหา IT</h2>
          <p className="mt-1 text-xs text-slate-500">แจ้งให้ทีม IT ทราบได้ทันที ระบบจะสร้าง Ticket และแจ้งรหัสติดตามให้</p>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1.5 text-[11px] font-semibold text-primary-700">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> ใช้เวลาประมาณ 2 นาที
        </span>
      </div>

      <div className="space-y-4 p-4 sm:p-6">
        {(loading || loadError) && (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs ${loadError ? 'border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200' : 'bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}`}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
            <span>{loading ? 'กำลังโหลดประเภทปัญหา…' : `${loadError} — แบบฟอร์มยังแสดงไว้เพื่อให้ตรวจสอบข้อมูลได้`}</span>
          </div>
        )}

        <FormSection icon={CircleHelp} title="ปัญหาที่พบ" subtitle="บอกอาการหรือปัญหา IT เข้าใจง่ายและแก้ได้เร็วขึ้น">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2 text-sm font-bold text-slate-700">
            <UserRound className="h-4 w-4 text-primary-600" aria-hidden="true" /> ข้อมูลผู้แจ้งและติดต่อกลับ
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="guestName">ชื่อผู้แจ้ง <Required /></label>
              <input id="guestName" className={INPUT} value={guestName} onChange={(event) => setGuestName(event.target.value)} required maxLength={160} placeholder="เช่น สมชาย ใจดี" />
            </div>
            <div>
              <label className={LABEL} htmlFor="phone">เบอร์โทร <Required /></label>
              <input id="phone" className={INPUT} value={requesterPhone} onChange={(event) => setRequesterPhone(event.target.value)} minLength={8} maxLength={40} required placeholder="ใช้ติดต่อกลับและค้นหาสถานะ" inputMode="tel" />
              <p className="mt-1 text-[11px] text-slate-500">ใช้คู่กับชื่อ–นามสกุลเพื่อค้นหา Ticket โดยไม่ต้องจำเลข Ticket</p>
            </div>
          </div>
          <div className="sm:max-w-[calc(50%-0.5rem)]">
            <label className={LABEL} htmlFor="department">แผนก/หน่วยงาน</label>
            <input id="department" className={INPUT} value={guestDepartment} onChange={(event) => setGuestDepartment(event.target.value)} maxLength={160} />
          </div>
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-1 text-sm font-bold text-slate-700">
            <CircleHelp className="h-4 w-4 text-primary-600" aria-hidden="true" /> รายละเอียดปัญหา
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="category">ประเภทปัญหา <Required /></label>
              <select id="category" className={INPUT} value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required disabled={formData.categories.length === 0}>
                <option value="">{loading ? 'กำลังโหลด…' : '-- เลือก --'}</option>
                {formData.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="priority">ความเร่งด่วน</label>
              <select id="priority" className={INPUT} value={priority} onChange={(event) => setPriority(event.target.value)}>
                <option value="">-- เลือก --</option>
                {formData.priorities.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={LABEL} htmlFor="title">สรุปปัญหาสั้น ๆ <Required /></label>
            <input id="title" className={INPUT} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} placeholder="เช่น เปิดเครื่องไม่ติด มีไฟกระพริบที่หน้าจอ" />
            <Counter value={title.length} max={200} />
          </div>
          <div>
            <label className={LABEL} htmlFor="description">รายละเอียดเพิ่มเติม <Required /></label>
            <textarea id="description" className={INPUT} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} required maxLength={3000} placeholder="อธิบายว่าเกิดอะไรขึ้น เริ่มเป็นเมื่อไร และลองแก้ไขอะไรไปแล้ว" />
            <Counter value={description.length} max={3000} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="location">จุดที่พบปัญหา <span className="font-normal text-slate-400">ถ้ามี</span></label>
              <input id="location" className={INPUT} value={location} onChange={(event) => setLocation(event.target.value)} maxLength={160} placeholder="เช่น อาคาร A ชั้น 3 ห้องบัญชี" />
            </div>
            <div>
              <label className={LABEL} htmlFor="assetCode">รหัสเครื่อง / Asset</label>
              <input id="assetCode" className={INPUT} value={assetCode} onChange={(event) => setAssetCode(event.target.value)} maxLength={80} placeholder="เช่น NB-0231" />
            </div>
          </div>
          <div className="rounded-xl border border-dashed border-primary-300 bg-primary-50/40 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="flex items-center gap-2 text-sm font-bold text-slate-700"><FileImage className="h-4 w-4 text-primary-600" aria-hidden="true" />แนบรูปภาพหรือไฟล์ประกอบ</p>
                <p className="mt-1 text-xs text-slate-500">JPG, PNG, GIF, WebP หรือ PDF · สูงสุด 5 ไฟล์ · ไฟล์ละไม่เกิน 10 MB</p>
              </div>
              <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-primary-300 bg-white px-4 py-2 text-xs font-bold text-primary-700 shadow-sm hover:bg-primary-50 dark:bg-slate-900 dark:hover:bg-primary-950/40">
                เลือกไฟล์
                <input type="file" className="sr-only" multiple accept="image/jpeg,image/png,image/gif,image/webp,application/pdf" onChange={selectAttachments} />
              </label>
            </div>
            {attachments.length > 0 && (
              <ul className="mt-3 space-y-2" aria-label="ไฟล์ที่เลือก">
                {attachments.map((file, index) => (
                  <li key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-primary-100 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                    <span className="min-w-0 truncate text-slate-700">{file.name} <span className="text-slate-400">({(file.size / (1024 * 1024)).toFixed(1)} MB)</span></span>
                    <button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="shrink-0 font-semibold text-red-600 hover:underline">นำออก</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </FormSection>

        <FormSection icon={ShieldCheck} title="ตรวจสอบก่อนส่ง" subtitle="อ่านและยอมรับเงื่อนไขก่อนส่งข้อมูล">
          <div className="rounded-lg border border-primary-200 bg-primary-50 px-4 py-3 text-xs leading-5 text-primary-900">
            <p className="font-bold">ประกาศการใช้ข้อมูลส่วนบุคคล</p>
            <p className="mt-1">{formData.privacy.summary}</p>
            <p className="mt-1 text-primary-700">เวอร์ชัน {formData.privacy.version} · ติดต่อ {formData.privacy.dpoContact}</p>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-4 py-3 text-xs leading-5 text-slate-600 transition hover:border-primary-200 hover:bg-primary-50/30">
            <input type="checkbox" checked={privacyConsent} onChange={(event) => setPrivacyConsent(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-700 focus:ring-primary-500" />
            <span>ข้าพเจ้าอ่านและยอมรับการใช้ข้อมูลเพื่อรับเรื่อง แจ้งสถานะ ดำเนินการแจ้งซ่อม และเก็บหลักฐานตามนโยบายขององค์กร</span>
          </label>
        </FormSection>

        <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} className="absolute left-[-9999px] opacity-0" aria-hidden="true" />

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-xl border border-primary-100 bg-primary-50/50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-primary-700 shadow-sm"><Check className="h-5 w-5" aria-hidden="true" /></span>
            <div>
              <p className="text-xs font-bold text-slate-800">พร้อมส่งให้ทีม IT</p>
              <p className="text-[11px] text-slate-500">ช่องที่มี <span className="text-red-500">*</span> จำเป็นต้องกรอก</p>
            </div>
          </div>
          <button type="submit" disabled={submitting || loading} className={PRIMARY_BUTTON}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            ส่งแจ้งซ่อม
          </button>
        </div>
      </div>
    </form>
  );
}

function FormSection({ icon: Icon, title, subtitle, children }: { icon: typeof Wrench; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/50 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700"><Icon className="h-4 w-4" aria-hidden="true" /></span>
        <div>
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Required() {
  return <span className="text-red-500" aria-label="จำเป็น">*</span>;
}

function Counter({ value, max }: { value: number; max: number }) {
  return <p className="mt-1 text-right text-[10px] text-slate-400">{value} / {max}</p>;
}

function KnowledgeTab() {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [query, setQuery] = useState({ search: '', categoryId: '' });
  const [data, setData] = useState<KnowledgeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.categoryId) params.set('categoryId', query.categoryId);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    setError(null);
    void publicTicketApiFetch<KnowledgeData>(`/api/v1/public/knowledge${suffix}`)
      .then(setData)
      .catch((loadError) => setError(loadError instanceof ApiError ? loadError.message : 'โหลดวิธีแก้เบื้องต้นไม่สำเร็จ'));
  }, [query]);

  return (
    <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="knowledge-title">
      <form className="grid gap-3 sm:grid-cols-[1fr_13rem_auto]" onSubmit={(event) => { event.preventDefault(); setQuery({ search: search.trim(), categoryId }); }}>
        <label><span className="sr-only">ค้นหา</span><input className={INPUT} value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} placeholder="ค้นหาอาการหรือวิธีแก้" /></label>
        <label><span className="sr-only">ประเภทปัญหา</span><select className={INPUT} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">ทุกประเภทปัญหา</option>{(data?.categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <button type="submit" className={PRIMARY_BUTTON}><Search className="h-4 w-4" aria-hidden="true" /> ค้นหา</button>
      </form>
      <div className="mt-5">
        {error && <ErrorCard message={error} />}
        {!data && !error && <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" aria-label="กำลังโหลด" />}
        {data && data.articles.length === 0 && <p className="rounded-lg bg-slate-50 p-8 text-center text-sm text-slate-500">ไม่พบวิธีแก้เบื้องต้นที่ตรงกับการค้นหา</p>}
        {data && data.articles.length > 0 && (
          <div className="space-y-3">
            {data.articles.map((article) => (
              <details key={article.id} className="group rounded-lg border border-slate-200 p-4">
                <summary className="cursor-pointer list-none"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-slate-800">{article.title}</p><p className="mt-1 text-xs text-slate-500">{article.article_code} · {article.category ?? 'ไม่ระบุประเภท'}</p></div><span className="text-xs text-primary-600 group-open:hidden">ดูวิธีแก้</span></div>{article.symptom && <p className="mt-2 text-sm text-slate-600">อาการ: {article.symptom}</p>}</summary>
                <div className="mt-3 whitespace-pre-wrap border-t border-slate-100 pt-3 text-sm text-slate-700"><p className="mb-1 font-medium">วิธีแก้</p>{article.solution}</div>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SubmittedCard({ result, onTrackStatus }: { result: SubmitResult; onTrackStatus: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copyToken() {
    try {
      await navigator.clipboard.writeText(result.trackingToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The token remains visible and can be selected manually.
    }
  }

  return (
    <div className={`${CARD} mx-auto max-w-2xl p-6`}>
      <div className="flex flex-col items-center gap-2 text-center"><CheckCircle2 className="h-12 w-12 text-emerald-600" aria-hidden="true" /><h2 className="text-lg font-bold text-slate-900">ส่งแจ้งซ่อมสำเร็จ</h2><p className="text-sm text-slate-500">กรุณาบันทึกรหัสติดตามนี้ไว้เพื่อเช็คสถานะภายหลัง</p></div>
      <div className="mt-5 rounded-lg border border-primary-200 bg-primary-50 p-4">
        <p className="text-xs text-slate-500">เลข Ticket</p>
        <p className="break-all font-mono text-sm text-slate-800">{result.ticketNo ?? result.id}</p>
        <p className="mt-4 text-xs font-semibold text-primary-800">รหัสติดตามของคุณ</p>
        <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-primary-200 bg-white px-4 py-3">
          <p className="font-mono text-lg font-extrabold tracking-wider text-primary-900" data-testid="public-tracking-code">{result.trackingToken}</p>
          <button type="button" onClick={() => void copyToken()} className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary-700 px-3 py-2 text-xs font-bold text-white hover:bg-primary-800" aria-label="คัดลอกรหัสติดตาม"><ClipboardCopy className="h-4 w-4" aria-hidden="true" /> คัดลอก</button>
        </div>
        <p className="mt-2 text-xs text-primary-800">ระบบบันทึก Ticket นี้ไว้ในเครื่องให้อัตโนมัติ กรุณาเก็บรหัสติดตามเป็นความลับเพราะใช้เปิดดูรายละเอียดและไฟล์แนบได้</p>
        {copied && <p className="mt-1 text-xs font-semibold text-emerald-600">คัดลอกรหัสแล้ว</p>}
      </div>
      {result.attachmentCount !== undefined && result.attachmentCount > 0 && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">แนบไฟล์สำเร็จ {result.attachmentCount} ไฟล์</p>
      )}
      {result.attachmentWarning && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="alert">{result.attachmentWarning}</p>
      )}
      <button type="button" onClick={onTrackStatus} className={`${PRIMARY_BUTTON} mt-4 w-full`}><Search className="h-4 w-4" aria-hidden="true" /> ไปที่หน้าติดตามสถานะ</button>
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
  const [lineBootstrap, setLineBootstrap] = useState<LineBootstrap | null>(null);
  const [lineTickets, setLineTickets] = useState<LineTicketSummary[] | null>(null);
  const [lineCheckLoading, setLineCheckLoading] = useState(() => Boolean(getLineSessionToken()));
  const [lineError, setLineError] = useState<string | null>(null);

  useEffect(() => {
    setSaved(getSavedTickets());
    if (!getLineSessionToken()) return;

    async function loadLineAccount() {
      try {
        const bootstrap = await lineApiFetch<LineBootstrap>('/api/v1/line/bootstrap');
        setLineBootstrap(bootstrap);
        if (bootstrap.authenticated && bootstrap.profile?.linkStatus !== 'Suspended') {
          setLineTickets(await lineApiFetch<LineTicketSummary[]>('/api/v1/line/tickets'));
        }
      } catch (loadError) {
        setLineError(loadError instanceof ApiError ? loadError.message : 'โหลดรายการ Ticket จาก LINE ไม่สำเร็จ');
      } finally {
        setLineCheckLoading(false);
      }
    }

    void loadLineAccount();
  }, []);

  async function lookup(id: string, trackingToken: string) {
    setLoading(true);
    setError(null);
    setDetail(null);
    try {
      setDetail(await publicTicketApiFetch<TrackedTicket>(`/api/v1/public/tickets/${encodeURIComponent(id)}`, {
        headers: { 'x-tracking-token': trackingToken },
      }));
    } catch (lookupError) {
      setError(lookupError instanceof ApiError ? lookupError.message : 'ค้นหาไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  async function openLineDetail(id: string) {
    setLoading(true);
    setLineError(null);
    try {
      setDetail(await lineApiFetch<TrackedTicket>(`/api/v1/line/tickets/${id}`));
    } catch (loadError) {
      setLineError(loadError instanceof ApiError ? loadError.message : 'โหลดรายละเอียด Ticket ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  if (detail) {
    return (
      <div className={`${CARD} mx-auto max-w-2xl p-5 sm:p-6`}>
        <button type="button" onClick={() => setDetail(null)} className="mb-4 text-sm text-slate-500 hover:text-primary-700">← กลับ</button>
        <p className="font-mono text-xs text-slate-500">{detail.ticket.ticket_no}</p><h2 className="mt-1 font-bold text-slate-900">{detail.ticket.title}</h2><p className="mt-1 text-xs text-slate-500">สถานะ: {ticketStatusLabel(detail.ticket.status)} · {detail.ticket.category?.name ?? '-'} · ความเร่งด่วน {detail.ticket.priority}</p><p className="mt-4 text-sm text-slate-600">{detail.ticket.description}</p>
        {detail.ticket.resolution && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">ผลดำเนินการ: {detail.ticket.resolution}</p>}
        {(detail.attachments ?? []).length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="mb-2 text-xs font-bold text-slate-700">ไฟล์แนบ ({detail.attachments.length})</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {detail.attachments.map((attachment) => (
                <a key={attachment.id} href={attachment.signed_url ?? undefined} target="_blank" rel="noreferrer" className={`rounded-lg border border-slate-200 p-2 text-xs text-primary-700 hover:bg-primary-50 ${attachment.signed_url ? '' : 'pointer-events-none opacity-60'}`}>
                  {attachment.mime_type.startsWith('image/') && attachment.signed_url && <img src={attachment.signed_url} alt={attachment.original_filename} className="mb-2 h-28 w-full rounded object-cover" />}
                  <span className="block truncate font-semibold">{attachment.original_filename}</span>
                  <span className="text-slate-400">{(attachment.size_bytes / (1024 * 1024)).toFixed(1)} MB</span>
                </a>
              ))}
            </div>
          </div>
        )}
        <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-500">{detail.worklogs.map((log, index) => <li key={index}>{log.action}{log.detail ? ` — ${log.detail}` : ''}</li>)}</ul>
      </div>
    );
  }

  if (lineCheckLoading) {
    return (
      <div className={`${CARD} flex items-center justify-center gap-2 p-10 text-sm text-slate-500`} role="status">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        กำลังโหลดรายการจากบัญชี LINE
      </div>
    );
  }

  if (lineBootstrap?.authenticated && lineBootstrap.profile?.linkStatus !== 'Suspended') {
    return (
      <section className={`${CARD} overflow-hidden`} aria-labelledby="line-ticket-list-title">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--line-brand)]" aria-hidden="true" />
              <h2 id="line-ticket-list-title" className="font-bold text-slate-900">รายการแจ้งซ่อมของฉัน</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">เข้าสู่ระบบด้วย LINE · {lineBootstrap.profile.fullName}</p>
          </div>
          <Link to="/line" className="public-line-button inline-flex items-center justify-center px-4 py-2 text-xs font-bold">
            แจ้งซ่อมผ่าน LINE
          </Link>
        </div>

        {lineError && <div className="m-4 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{lineError}</div>}
        {lineTickets === null ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500" role="status"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />กำลังโหลดรายการ</div>
        ) : lineTickets.length === 0 ? (
          <div className="p-10 text-center"><TicketCheck className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" /><p className="mt-2 text-sm text-slate-500">ยังไม่มีรายการแจ้งซ่อมผ่านบัญชี LINE นี้</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3">เลข Ticket</th>
                  <th scope="col" className="px-4 py-3">รายการ</th>
                  <th scope="col" className="px-4 py-3">ประเภท</th>
                  <th scope="col" className="px-4 py-3">ความเร่งด่วน</th>
                  <th scope="col" className="px-4 py-3">สถานะ</th>
                  <th scope="col" className="px-4 py-3">วันที่แจ้ง</th>
                  <th scope="col" className="px-5 py-3 text-right">ดูข้อมูล</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lineTickets.map((ticket) => (
                  <tr key={ticket.id} className="transition hover:bg-primary-50/40">
                    <td className="whitespace-nowrap px-5 py-4 font-mono text-xs font-semibold text-primary-700">{ticket.ticket_no}</td>
                    <td className="max-w-xs px-4 py-4"><p className="truncate font-medium text-slate-800" title={ticket.title}>{ticket.title}</p></td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">{ticket.category?.name ?? '-'}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">{ticket.priority}</td>
                    <td className="whitespace-nowrap px-4 py-4"><Badge variant={ticketStatusTone(ticket.status)}>{ticketStatusLabel(ticket.status)}</Badge></td>
                    <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">{formatTicketDate(ticket.created_at)}</td>
                    <td className="px-5 py-4 text-right"><button type="button" disabled={loading} onClick={() => void openLineDetail(ticket.id)} className="rounded-md px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-100 disabled:opacity-50">รายละเอียด</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className={`${CARD} mx-auto max-w-2xl p-5 sm:p-6`}>
      {lineBootstrap?.authenticated && lineBootstrap.profile?.linkStatus === 'Suspended' && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          บัญชี LINE นี้ถูกระงับ จึงยังแสดงรายการ Ticket อัตโนมัติไม่ได้
          <Link to="/line" className="ml-1 font-semibold text-primary-700 hover:underline">ดูรายละเอียด</Link>
        </div>
      )}
      {lineError && <div className="mb-5 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{lineError}</div>}
      {saved.length > 0 && <div className="mb-5"><p className="mb-2 text-xs font-bold text-slate-500">Ticket ที่เคยแจ้งจากเครื่องนี้</p><ul className="space-y-2">{saved.map((row) => <li key={row.id}><button type="button" onClick={() => void lookup(row.ticketNo ?? row.id, row.trackingToken)} className="w-full truncate rounded-lg border border-slate-200 px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-50">{row.ticketNo ?? row.id}</button></li>)}</ul></div>}
      <div className="mb-5 rounded-lg bg-primary-50 px-3 py-2 text-xs text-primary-800">เพื่อปกป้องรายละเอียดและไฟล์แนบ ต้องใช้เลข Ticket คู่กับรหัสติดตาม หรือเข้าสู่ระบบด้วย LINE</div>
      <form onSubmit={(event) => { event.preventDefault(); void lookup(ticketId, token); }} className="space-y-4" data-testid="public-ticket-code-search">
        <div><label className={LABEL} htmlFor="ticketId">เลข Ticket</label><input id="ticketId" className={INPUT} value={ticketId} onChange={(event) => setTicketId(event.target.value)} required placeholder="เช่น TCK-2026-0001" /></div>
        <div><label className={LABEL} htmlFor="token">รหัสติดตาม</label><input id="token" className={INPUT} value={token} onChange={(event) => setToken(event.target.value)} required maxLength={64} placeholder="เช่น ABCD-EFGH-JKLM" autoComplete="off" /><p className="mt-1 text-[11px] text-slate-500">รหัสนี้แสดงหลังส่งแจ้งซ่อมสำเร็จ และระบบบันทึกไว้ในเครื่องที่ใช้แจ้งให้อัตโนมัติ</p></div>
        {error && <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{error}</div>}
        <button type="submit" disabled={loading} className={`${PRIMARY_BUTTON} w-full`}>{loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />} ตรวจสอบสถานะ</button>
      </form>
    </div>
  );
}

function formatTicketDate(value: string) {
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function ticketStatusTone(status: string): 'success' | 'danger' | 'warning' | 'primary' {
  if (['เสร็จสิ้น', 'ปิดงาน'].includes(status)) return 'success';
  if (['ยกเลิก', 'ปฏิเสธ'].includes(status)) return 'danger';
  if (['กำลังดำเนินการ', 'รอข้อมูล', 'รอผู้ใช้งาน'].includes(status)) return 'warning';
  return 'primary';
}

function ticketStatusLabel(status: string) {
  if (status === 'เสร็จสิ้น') return 'ซ่อมเสร็จ (รอยืนยัน)';
  if (status === 'ปิดงาน') return 'ปิดงานแล้ว';
  return status;
}

function ErrorCard({ message }: { message: string }) {
  return <div className={`${CARD} flex items-center gap-2 p-5 text-sm text-red-700`} role="alert"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{message}</span></div>;
}
