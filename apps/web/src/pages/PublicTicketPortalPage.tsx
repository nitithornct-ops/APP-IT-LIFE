import type { TicketRatingCriterion, TicketRatingDetails, TicketRatingSnapshotItem } from '@itlife/shared';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ClipboardCopy,
  ClipboardList,
  Clock3,
  FileImage,
  History,
  LifeBuoy,
  Loader2,
  LockKeyhole,
  MessageCircle,
  PackageSearch,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  TicketCheck,
  UserRound,
  Wrench,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicBrand } from '../components/PublicBrand';
import { LineProfileNameForm } from '../components/LineProfileNameForm';
import { TurnstileWidget, type TurnstileWidgetHandle } from '../components/TurnstileWidget';
import { Badge } from '../components/ui/Badge';
import { RequesterSignoffCard } from '../components/tickets/RequesterSignoffCard';
import { ticketStatusLabel, ticketStatusTone, type TicketStatusTone } from '../features/tickets/ticketDisplay';
import { getTicketFlowIndex, isTicketFlowInterrupted, TICKET_FLOW_STEPS } from '../features/tickets/ticketFlow';
import { ApiError } from '../services/apiClient';
import { getLineSessionToken, lineApiFetch } from '../services/lineApiClient';
import { publicTicketApiFetch } from '../services/publicTicketApiClient';
import type { TicketPriority, TicketStatus } from '../types/tickets';

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
  privacy: { version: string; summary: string; dpoContact: string; consentText?: string };
}

interface SubmitResult {
  id: string;
  ticketNo?: string;
  trackingToken?: string;
  channel?: 'guest' | 'line';
  attachmentCount?: number;
  attachmentWarning?: string;
}

type SavedTicket = SubmitResult & { trackingToken: string };
interface TrackedTicket {
  ticket: {
    id: string;
    ticket_no: string;
    title: string;
    description: string;
    status: TicketStatus;
    priority: TicketPriority;
    resolution: string | null;
    created_at: string;
    resolved_at: string | null;
    closed_at: string | null;
    requester_name_snapshot?: string | null;
    guest_name?: string | null;
    rating: number | null;
    rating_details: TicketRatingDetails | null;
    rating_criteria_snapshot: TicketRatingSnapshotItem[] | null;
    feedback: string | null;
    feedback_at: string | null;
    requester_signature_url: string | null;
    requester_signature_uploaded_at: string | null;
    category: { name: string } | null;
  };
  ratingCriteria: TicketRatingCriterion[];
  worklogs: Array<{
    id?: string;
    /** ไม่มีค่าเมื่อ API รุ่นเก่ายังไม่ส่งกลับมา — ถือเป็นรายการไทม์ไลน์ตามเดิม */
    entry_type?: 'timeline' | 'comment' | 'internal_note' | 'worklog';
    action: string;
    detail: string | null;
    status_from: TicketStatus | null;
    status_to: TicketStatus | null;
    created_at: string;
    /** ไม่มี actor_id/actor คือข้อความของผู้แจ้งเอง ที่เหลือคือทีม IT */
    actor_id?: string | null;
    actor_line_user_id?: string | null;
    actor_label?: string | null;
    actor?: { full_name: string } | null;
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
    department?: string;
    linkStatus: string;
  } | null;
}

interface LineTicketSummary {
  id: string;
  ticket_no: string;
  title: string;
  priority: TicketPriority;
  status: TicketStatus;
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
const DRAFT_KEY = 'public_ticket_draft';
const INPUT = 'public-field w-full px-3 py-2.5 text-sm placeholder:text-slate-400 transition focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50';
const LABEL = 'mb-1.5 block text-sm font-medium text-slate-700';
const PRIMARY_BUTTON = 'public-primary-button inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60';
const CARD = 'public-sheet';
const DEFAULT_PRIVACY = {
  version: '2026-08-31',
  summary: 'ระบบใช้ข้อมูลผู้แจ้งเพื่อรับเรื่อง ติดต่อกลับ ดำเนินการแจ้งซ่อม และแจ้งสถานะ Ticket เท่านั้น',
  dpoContact: 'DPO / ส่วนงาน IT',
  consentText: 'ข้าพเจ้าอ่านและยอมรับการใช้ข้อมูลเพื่อรับเรื่อง แจ้งสถานะ ดำเนินการแจ้งซ่อม และเก็บหลักฐานตามนโยบายขององค์กร',
};
/** ใบที่จบแล้วไม่รับข้อความใหม่ — ตรงกับกฎฝั่ง API ทั้งช่องทาง guest และ LINE */
const CONVERSATION_LOCKED_STATUSES: TicketStatus[] = ['ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident'];
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

interface TicketDraft {
  guestName: string;
  requesterPosition: string;
  requesterPhone: string;
  guestDepartment: string;
  incidentAt: string;
  erpModule: string;
  location: string;
  assetCode: string;
  categoryId: string;
  priority: string;
  title: string;
  description: string;
  privacyConsent: boolean;
}

function currentLocalDateTime(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function getTicketDraft(): Partial<TicketDraft> {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<TicketDraft>;
    return draft && typeof draft === 'object' ? draft : {};
  } catch {
    return {};
  }
}

function saveTicketDraft(draft: TicketDraft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Draft persistence is best-effort; the live form remains usable without Web Storage.
  }
}

function clearTicketDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing else is required after a successful submission.
  }
}

function getSavedTickets(): SavedTicket[] {
  try {
    const rows = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as SubmitResult[];
    return Array.isArray(rows)
      ? rows.filter((row): row is SavedTicket => typeof row.trackingToken === 'string' && row.trackingToken.length > 0).slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

function rememberTicket(result: SavedTicket) {
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
  const [lineBootstrap, setLineBootstrap] = useState<LineBootstrap | null>(null);
  const [lineCheckLoading, setLineCheckLoading] = useState(() => Boolean(getLineSessionToken()));

  useEffect(() => {
    if (!getLineSessionToken()) return;
    void lineApiFetch<LineBootstrap>('/api/v1/line/bootstrap')
      .then(setLineBootstrap)
      .catch(() => setLineBootstrap(null))
      .finally(() => setLineCheckLoading(false));
  }, []);

  return (
    <main className="life-public min-h-screen text-slate-800">
      <div className="mx-auto grid min-h-screen w-full max-w-[1440px] gap-4 p-3 sm:p-4 lg:grid-cols-[250px_minmax(0,1fr)] lg:p-5">
        <PortalSidebar tab={tab} onChange={setTab} />

        <div className="min-w-0">
          <LineBanner bootstrap={lineBootstrap} loading={lineCheckLoading} onStatus={() => setTab('status')} />
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

          {lineCheckLoading ? (
            <div className="public-sheet flex items-center justify-center gap-2 p-10 text-sm text-slate-500" role="status">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> กำลังตรวจสอบข้อมูล LINE
            </div>
          ) : lineBootstrap?.authenticated && lineBootstrap.profile?.linkStatus !== 'Suspended' && !lineBootstrap.profile?.fullName.trim() ? (
            <LineProfileNameForm onSaved={(fullName) => setLineBootstrap((current) => current?.profile ? {
              ...current,
              profile: { ...current.profile, fullName },
            } : current)} />
          ) : (
            <>
              {tab === 'report' && <ReportTab lineProfile={lineBootstrap?.authenticated ? lineBootstrap.profile : null} onSubmitted={() => setTab('status')} />}
              {tab === 'knowledge' && <KnowledgeTab />}
              {tab === 'status' && <StatusTab onReport={() => setTab('report')} />}
            </>
          )}
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

function LineBanner({ bootstrap, loading, onStatus }: { bootstrap: LineBootstrap | null; loading: boolean; onStatus: () => void }) {
  const authenticated = bootstrap?.authenticated && bootstrap.profile?.linkStatus !== 'Suspended';
  return (
    <div className="public-sheet flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="public-line-button flex h-[42px] w-[42px] shrink-0 items-center justify-center">
          <MessageCircle className="h-5 w-5 fill-current" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800">{authenticated ? 'เข้าสู่ระบบ LINE แล้ว' : 'เข้าสู่ระบบด้วย LINE'}</p>
          <p className="text-xs text-slate-500">
            {authenticated ? `${bootstrap.profile?.fullName ?? 'ผู้ใช้งาน LINE'} · Ticket ที่ส่งจะผูกกับบัญชีนี้` : 'แจ้งซ่อมและติดตามสถานะได้สะดวก พร้อมรับการแจ้งเตือน'}
          </p>
        </div>
      </div>
      {loading ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 px-4 py-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> กำลังตรวจสอบ LINE</span>
      ) : authenticated ? (
        <button type="button" onClick={onStatus} className="public-line-button inline-flex shrink-0 items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold transition">
          <TicketCheck className="h-3.5 w-3.5" aria-hidden="true" /> สถานะของฉัน
        </button>
      ) : (
        <Link to="/line?mode=report" className="public-line-button inline-flex shrink-0 items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold transition">
          <MessageCircle className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> LINE Login
        </Link>
      )}
    </div>
  );
}

function ReportTab({ lineProfile, onSubmitted }: { lineProfile: LineBootstrap['profile']; onSubmitted: () => void }) {
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
      lineProfile={lineProfile}
      onSubmitted={(submitted) => {
        if (submitted.trackingToken) rememberTicket({ ...submitted, trackingToken: submitted.trackingToken });
        setResult(submitted);
      }}
    />
  );
}

function ReportForm({ formData, loading, loadError, lineProfile, onSubmitted }: { formData: FormData; loading: boolean; loadError: string | null; lineProfile: LineBootstrap['profile']; onSubmitted: (result: SubmitResult) => void }) {
  const [initialDraft] = useState(getTicketDraft);
  const [guestName, setGuestName] = useState(initialDraft.guestName ?? '');
  const [requesterPosition, setRequesterPosition] = useState(initialDraft.requesterPosition ?? '');
  const [requesterPhone, setRequesterPhone] = useState(initialDraft.requesterPhone ?? '');
  const [guestDepartment, setGuestDepartment] = useState(initialDraft.guestDepartment ?? '');
  const [incidentAt, setIncidentAt] = useState(initialDraft.incidentAt ?? currentLocalDateTime());
  const [erpModule, setErpModule] = useState(initialDraft.erpModule ?? '');
  const [location, setLocation] = useState(initialDraft.location ?? '');
  const [assetCode, setAssetCode] = useState(initialDraft.assetCode ?? '');
  const [categoryId, setCategoryId] = useState(initialDraft.categoryId ?? '');
  const [priority, setPriority] = useState(initialDraft.priority ?? '');
  const [title, setTitle] = useState(initialDraft.title ?? '');
  const [description, setDescription] = useState(initialDraft.description ?? '');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [privacyConsent, setPrivacyConsent] = useState(initialDraft.privacyConsent ?? false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lineAuthenticated = Boolean(lineProfile && lineProfile.linkStatus !== 'Suspended');

  useEffect(() => {
    if (!lineAuthenticated) return;
    setGuestName(lineProfile?.fullName || '');
    setGuestDepartment((current) => current || lineProfile?.department || '');
  }, [lineAuthenticated, lineProfile]);

  useEffect(() => {
    saveTicketDraft({ guestName, requesterPosition, requesterPhone, guestDepartment, incidentAt, erpModule, location, assetCode, categoryId, priority, title, description, privacyConsent });
  }, [guestName, requesterPosition, requesterPhone, guestDepartment, incidentAt, erpModule, location, assetCode, categoryId, priority, title, description, privacyConsent]);

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
    const normalizedPhone = requesterPhone.trim();
    const normalizedRequesterName = guestName.trim().replace(/\s+/g, ' ');
    if (normalizedRequesterName.split(/\s+/).length < 2) {
      setError('กรุณากรอกทั้งชื่อและนามสกุลผู้แจ้ง');
      return;
    }
    if (!privacyConsent) {
      setError('กรุณายอมรับประกาศการใช้ข้อมูลส่วนบุคคลก่อนส่ง Ticket');
      return;
    }
    if (!lineAuthenticated && !turnstileToken) {
      setError('กรุณายืนยันความปลอดภัยก่อนส่ง Ticket');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (lineAuthenticated && normalizedRequesterName !== lineProfile?.fullName) {
        await lineApiFetch('/api/v1/line/profile', {
          method: 'PATCH',
          body: JSON.stringify({ fullName: normalizedRequesterName }),
        });
      }
      const commonPayload = {
        requesterPhone: normalizedPhone || undefined,
        requesterPosition: requesterPosition || undefined,
        incidentAt: new Date(incidentAt).toISOString(),
        erpModule: erpModule || undefined,
        location: location || undefined,
        assetCode: assetCode || undefined,
        categoryId,
        priority: priority || undefined,
        title,
        description,
        privacyConsent: true as const,
      };
      const submitted: SubmitResult = lineAuthenticated
        ? await lineApiFetch<{ id: string; ticket_no?: string }>('/api/v1/line/tickets', {
          method: 'POST',
          body: JSON.stringify({ ...commonPayload, department: guestDepartment || undefined }),
        }).then((ticket) => ({ id: ticket.id, ticketNo: ticket.ticket_no, channel: 'line' as const }))
        : await publicTicketApiFetch<SubmitResult>('/api/v1/public/tickets', {
          method: 'POST',
          body: JSON.stringify({ ...commonPayload, guestName: normalizedRequesterName, guestDepartment: guestDepartment || undefined, website: website || undefined, turnstileToken }),
        });
      let attachmentCount = 0;
      let attachmentWarning: string | undefined;
      for (const file of attachments) {
        try {
          const uploadBody = new window.FormData();
          uploadBody.append('file', file);
          if (lineAuthenticated) {
            await lineApiFetch(`/api/v1/line/tickets/${submitted.id}/attachments`, { method: 'POST', body: uploadBody });
          } else {
            await publicTicketApiFetch(`/api/v1/public/tickets/${submitted.id}/attachments`, {
              method: 'POST',
              headers: { 'x-tracking-token': submitted.trackingToken ?? '' },
              body: uploadBody,
            });
          }
          attachmentCount += 1;
        } catch (uploadError) {
          attachmentWarning = uploadError instanceof ApiError
            ? `สร้าง Ticket แล้ว แต่อัปโหลดไฟล์บางรายการไม่สำเร็จ: ${uploadError.message}`
            : 'สร้าง Ticket แล้ว แต่อัปโหลดไฟล์บางรายการไม่สำเร็จ';
          break;
        }
      }
      clearTicketDraft();
      onSubmitted({ ...submitted, attachmentCount, attachmentWarning });
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : 'ส่งแจ้งซ่อมไม่สำเร็จ');
    } finally {
      if (!lineAuthenticated) turnstileRef.current?.reset();
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

        <FormSection icon={CircleHelp} title="ส่วนที่ 1: ข้อมูลผู้แจ้ง และรายละเอียดปัญหา" subtitle="ข้อมูลชุดเดียวกับแบบฟอร์ม Ticket สำหรับใช้รับเรื่องและจัดทำเอกสาร">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2 text-sm font-bold text-slate-700">
            <UserRound className="h-4 w-4 text-primary-600" aria-hidden="true" /> ข้อมูลผู้แจ้งและติดต่อกลับ
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="guestName">ชื่อ–นามสกุลผู้แจ้ง <Required /></label>
              <input id="guestName" className={INPUT} value={guestName} onChange={(event) => setGuestName(event.target.value)} required maxLength={160} autoComplete="name" placeholder="เช่น สมชาย ใจดี" />
              {lineAuthenticated && <p className="mt-1 text-[11px] text-slate-500">ใช้ชื่อจริงในใบแจ้งซ่อม ระบบจะบันทึกชื่อนี้แทนชื่อโปรไฟล์ LINE</p>}
            </div>
            <div>
              <label className={LABEL} htmlFor="phone">เบอร์โทร <span className="font-normal text-slate-400">(ไม่บังคับ)</span></label>
              <input id="phone" className={INPUT} value={requesterPhone} onChange={(event) => setRequesterPhone(event.target.value)} maxLength={40} placeholder="เช่น 081-234-5678" inputMode="tel" autoComplete="tel" />
              <p className="mt-1 text-[11px] text-slate-500">กรอกเมื่อสะดวกให้ทีม IT โทรติดต่อกลับ หากไม่กรอกยังส่งแจ้งซ่อมได้ตามปกติ</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="position">ตำแหน่ง</label>
              <input id="position" className={INPUT} value={requesterPosition} onChange={(event) => setRequesterPosition(event.target.value)} maxLength={160} />
            </div>
            <div>
              <label className={LABEL} htmlFor="department">ส่วนงาน/แผนก</label>
              <input id="department" className={INPUT} value={guestDepartment} onChange={(event) => setGuestDepartment(event.target.value)} maxLength={160} />
            </div>
          </div>
          <div>
            <label className={LABEL} htmlFor="incidentAt">วันที่และเวลาที่พบปัญหา <Required /></label>
            <input id="incidentAt" type="datetime-local" className={INPUT} value={incidentAt} onChange={(event) => setIncidentAt(event.target.value)} required />
          </div>
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-1 text-sm font-bold text-slate-700">
            <CircleHelp className="h-4 w-4 text-primary-600" aria-hidden="true" /> รายละเอียดปัญหา
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="category">ประเภทงานที่ขอรับบริการ <Required /></label>
              <select id="category" className={INPUT} value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required disabled={formData.categories.length === 0}>
                <option value="">{loading ? 'กำลังโหลด…' : '-- เลือก --'}</option>
                {formData.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="priority">ระดับความรุนแรง</label>
              <select id="priority" className={INPUT} value={priority} onChange={(event) => setPriority(event.target.value)}>
                <option value="">-- เลือก --</option>
                {formData.priorities.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={LABEL} htmlFor="erpModule">ERP Module <span className="font-normal text-slate-400">ถ้ามี</span></label>
            <input id="erpModule" className={INPUT} value={erpModule} onChange={(event) => setErpModule(event.target.value)} maxLength={120} placeholder="เช่น Finance, Inventory" />
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
            <span>{formData.privacy.consentText ?? DEFAULT_PRIVACY.consentText}</span>
          </label>
          {!lineAuthenticated && (
            <TurnstileWidget ref={turnstileRef} action="public_ticket" onTokenChange={setTurnstileToken} />
          )}
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
          <button type="submit" disabled={submitting || loading || (!lineAuthenticated && !turnstileToken)} className={PRIMARY_BUTTON}>
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
    const trackingToken = result.trackingToken;
    if (!trackingToken) return;
    try {
      await navigator.clipboard.writeText(trackingToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The token remains visible and can be selected manually.
    }
  }

  return (
    <div className={`${CARD} mx-auto max-w-2xl p-6`}>
      <div className="flex flex-col items-center gap-2 text-center"><CheckCircle2 className="h-12 w-12 text-emerald-600" aria-hidden="true" /><h2 className="text-lg font-bold text-slate-900">ส่งแจ้งซ่อมสำเร็จ</h2><p className="text-sm text-slate-500">{result.channel === 'line' ? 'Ticket ผูกกับบัญชี LINE แล้ว ติดตามสถานะได้ทันที' : 'กรุณาบันทึกรหัสติดตามนี้ไว้เพื่อเช็คสถานะภายหลัง'}</p></div>
      <div className="mt-5 rounded-lg border border-primary-200 bg-primary-50 p-4">
        <p className="text-xs text-slate-500">เลข Ticket</p>
        <p className="break-all font-mono text-sm text-slate-800">{result.ticketNo ?? result.id}</p>
        {result.trackingToken ? (
          <>
            <p className="mt-4 text-xs font-semibold text-primary-800">รหัสติดตามของคุณ</p>
            <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-primary-200 bg-white px-4 py-3">
              <p className="font-mono text-lg font-extrabold tracking-wider text-primary-900" data-testid="public-tracking-code">{result.trackingToken}</p>
              <button type="button" onClick={() => void copyToken()} className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary-700 px-3 py-2 text-xs font-bold text-white hover:bg-primary-800" aria-label="คัดลอกรหัสติดตาม"><ClipboardCopy className="h-4 w-4" aria-hidden="true" /> คัดลอก</button>
            </div>
            <p className="mt-2 text-xs text-primary-800">ระบบบันทึก Ticket นี้ไว้ในเครื่องให้อัตโนมัติ กรุณาเก็บรหัสติดตามเป็นความลับเพราะใช้เปิดดูรายละเอียดและไฟล์แนบได้</p>
            {copied && <p className="mt-1 text-xs font-semibold text-emerald-600">คัดลอกรหัสแล้ว</p>}
          </>
        ) : (
          <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-primary-800">ใช้เมนู “สถานะของฉัน” เพื่อเปิดดู Ticket นี้ได้โดยไม่ต้องกรอกรหัสติดตาม</p>
        )}
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

function StatusTab({ onReport }: { onReport: () => void }) {
  const [saved, setSaved] = useState<SavedTicket[]>([]);
  const [ticketId, setTicketId] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<TrackedTicket | null>(null);
  const [detailAccess, setDetailAccess] = useState<{ channel: 'guest' | 'line'; id: string; token?: string } | null>(null);
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
      const loaded = await publicTicketApiFetch<TrackedTicket>(`/api/v1/public/tickets/${encodeURIComponent(id)}`, {
        headers: { 'x-tracking-token': trackingToken },
      });
      setDetail(loaded);
      setDetailAccess({ channel: 'guest', id: loaded.ticket.id, token: trackingToken });
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
      setDetailAccess({ channel: 'line', id });
    } catch (loadError) {
      setLineError(loadError instanceof ApiError ? loadError.message : 'โหลดรายละเอียด Ticket ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  /** ดึงใบเดิมซ้ำจากช่องทางที่เปิดอยู่ — ใช้ทั้งหลังส่งข้อความและตอนรีเฟรชอัตโนมัติ */
  async function reloadDetail(access: NonNullable<typeof detailAccess>): Promise<TrackedTicket> {
    return access.channel === 'line'
      ? lineApiFetch<TrackedTicket>(`/api/v1/line/tickets/${access.id}`)
      : publicTicketApiFetch<TrackedTicket>(`/api/v1/public/tickets/${encodeURIComponent(access.id)}`, {
        headers: { 'x-tracking-token': access.token ?? '' },
      });
  }

  // ผู้แจ้งเปิดหน้านี้ค้างไว้รอคำตอบจากช่าง จึงดึงซ้ำเป็นระยะแทนที่จะให้กด refresh เอง
  // ผูกกับ detailAccess ไม่ใช่ detail เพื่อไม่ให้ตั้ง interval ใหม่ทุกครั้งที่ข้อมูลเปลี่ยน
  useEffect(() => {
    if (!detailAccess) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void reloadDetail(detailAccess).then(setDetail).catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailAccess]);

  async function sendMessage(message: string) {
    if (!detailAccess) throw new Error('ไม่พบข้อมูลสำหรับส่งข้อความ');
    if (detailAccess.channel === 'line') {
      await lineApiFetch(`/api/v1/line/tickets/${detailAccess.id}/messages`, { method: 'POST', body: JSON.stringify({ message }) });
    } else {
      await publicTicketApiFetch(`/api/v1/public/tickets/${encodeURIComponent(detailAccess.id)}/conversation`, {
        method: 'POST',
        headers: { 'x-tracking-token': detailAccess.token ?? '' },
        body: JSON.stringify({ message }),
      });
    }
    setDetail(await reloadDetail(detailAccess));
  }

  async function signoff(file: File, ratings: TicketRatingDetails, feedback?: string) {
    if (!detailAccess) throw new Error('ไม่พบข้อมูลสำหรับยืนยัน Ticket');
    const body = new window.FormData();
    body.set('file', file);
    body.set('ratings', JSON.stringify(ratings));
    if (feedback) body.set('feedback', feedback);
    if (detailAccess.channel === 'line') {
      await lineApiFetch(`/api/v1/line/tickets/${detailAccess.id}/signoff`, { method: 'POST', body });
      setDetail(await lineApiFetch<TrackedTicket>(`/api/v1/line/tickets/${detailAccess.id}`));
      setLineTickets(await lineApiFetch<LineTicketSummary[]>('/api/v1/line/tickets'));
    } else {
      const headers = { 'x-tracking-token': detailAccess.token ?? '' };
      await publicTicketApiFetch(`/api/v1/public/tickets/${encodeURIComponent(detailAccess.id)}/signoff`, { method: 'POST', headers, body });
      setDetail(await publicTicketApiFetch<TrackedTicket>(`/api/v1/public/tickets/${encodeURIComponent(detailAccess.id)}`, { headers }));
    }
  }

  if (detail) {
    return (
      <TicketDetailView
        detail={detail}
        onBack={() => { setDetail(null); setDetailAccess(null); }}
        onSign={signoff}
        onSendMessage={sendMessage}
      />
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

  const hasActiveLineAccount = Boolean(
    lineBootstrap?.authenticated
    && lineBootstrap.profile
    && lineBootstrap.profile.linkStatus !== 'Suspended',
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {hasActiveLineAccount && lineBootstrap?.profile && (
        <LineTicketList
          profileName={lineBootstrap.profile.fullName}
          tickets={lineTickets}
          loading={loading}
          onOpen={openLineDetail}
          onReport={onReport}
        />
      )}

      {lineBootstrap?.authenticated && lineBootstrap.profile?.linkStatus === 'Suspended' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          บัญชี LINE นี้ถูกระงับ จึงยังแสดงรายการ Ticket อัตโนมัติไม่ได้
          <Link to="/line" className="ml-1 font-semibold text-primary-700 hover:underline">ดูรายละเอียด</Link>
        </div>
      )}
      {lineError && <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{lineError}</div>}

      <GuestTicketLookup
        saved={saved}
        ticketId={ticketId}
        token={token}
        loading={loading}
        error={error}
        onTicketIdChange={setTicketId}
        onTokenChange={setToken}
        onLookup={lookup}
      />
    </div>
  );
}

/** สีและไอคอนของแต่ละขั้นใน TICKET_FLOW_STEPS เรียงตาม index เดียวกัน */
const TICKET_FLOW_STEP_STYLES: Array<{ icon: typeof TicketCheck; reachedClass: string; ringClass: string }> = [
  { icon: TicketCheck, reachedClass: 'border-cyan-500 bg-cyan-500 text-white', ringClass: 'ring-cyan-100' },
  { icon: ClipboardList, reachedClass: 'border-primary-600 bg-primary-600 text-white', ringClass: 'ring-primary-100' },
  { icon: Wrench, reachedClass: 'border-purple-600 bg-purple-600 text-white', ringClass: 'ring-purple-100' },
  { icon: CheckCircle2, reachedClass: 'border-amber-500 bg-amber-500 text-white', ringClass: 'ring-amber-100' },
  { icon: ShieldCheck, reachedClass: 'border-emerald-600 bg-emerald-600 text-white', ringClass: 'ring-emerald-100' },
];

const STATUS_TONE_STYLES: Record<TicketStatusTone, { panel: string; icon: string; dot: string }> = {
  secondary: {
    panel: 'border-slate-200 bg-slate-50/90',
    icon: 'bg-slate-600 text-white',
    dot: 'bg-slate-500',
  },
  info: {
    panel: 'border-cyan-200 bg-cyan-50/90',
    icon: 'bg-cyan-600 text-white',
    dot: 'bg-cyan-500',
  },
  primary: {
    panel: 'border-primary-200 bg-primary-50/90',
    icon: 'bg-primary-700 text-white',
    dot: 'bg-primary-600',
  },
  warning: {
    panel: 'border-amber-200 bg-amber-50/90',
    icon: 'bg-amber-500 text-white',
    dot: 'bg-amber-500',
  },
  success: {
    panel: 'border-emerald-200 bg-emerald-50/90',
    icon: 'bg-emerald-600 text-white',
    dot: 'bg-emerald-600',
  },
  danger: {
    panel: 'border-rose-200 bg-rose-50/90',
    icon: 'bg-rose-600 text-white',
    dot: 'bg-rose-600',
  },
};

function TicketDetailView({
  detail,
  onBack,
  onSign,
  onSendMessage,
}: {
  detail: TrackedTicket;
  onBack: () => void;
  onSign: (file: File, ratings: TicketRatingDetails, feedback?: string) => Promise<void>;
  onSendMessage: (message: string) => Promise<void>;
}) {
  const { ticket } = detail;
  const lastWorklog = detail.worklogs[detail.worklogs.length - 1];
  const lastUpdatedAt = lastWorklog?.created_at ?? ticket.created_at;
  // บทสนทนากับไทม์ไลน์เก็บในตารางเดียวกัน แยกด้วย entry_type เพื่อให้แต่ละส่วนอ่านได้เป็นเรื่องเดียว
  const conversation = detail.worklogs.filter((log) => log.entry_type === 'comment');
  const timeline = detail.worklogs.filter((log) => log.entry_type !== 'comment');
  const signoffCard = (
    <RequesterSignoffCard
      status={ticket.status}
      signatureUrl={ticket.requester_signature_url}
      signedAt={ticket.requester_signature_uploaded_at}
      requesterName={ticket.requester_name_snapshot ?? ticket.guest_name}
      criteria={detail.ratingCriteria ?? []}
      rating={ticket.rating}
      onSign={onSign}
    />
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <section className={`${CARD} overflow-hidden`} aria-labelledby="tracked-ticket-title">
        <div className="bg-gradient-to-br from-primary-950 via-primary-900 to-primary-700 p-5 sm:p-6">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3.5 text-sm font-semibold !text-white hover:bg-white/20"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            กลับไปหน้ารายการ
          </button>
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-mono text-xs font-semibold text-primary-100">
                <TicketCheck className="h-4 w-4" aria-hidden="true" /> {ticket.ticket_no}
              </p>
              <h2 id="tracked-ticket-title" className="mt-2 !text-xl font-bold !text-white sm:!text-2xl">{ticket.title}</h2>
              <div className="mt-4 flex flex-wrap gap-2 text-xs !text-white">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5">
                  <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" /> {ticket.category?.name ?? 'ไม่ระบุประเภท'}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> ความเร่งด่วน {ticket.priority}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> แจ้งเมื่อ {formatTicketDate(ticket.created_at)}
                </span>
              </div>
            </div>
            <div className="shrink-0 rounded-xl border border-white/20 bg-white px-3 py-2 shadow-sm">
              <Badge variant={ticketStatusTone[ticket.status]}>{ticketStatusLabel[ticket.status]}</Badge>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-4 sm:p-6">
          <CurrentTicketStatus status={ticket.status} updatedAt={lastUpdatedAt} />
          <TicketStatusFlow status={ticket.status} worklogs={timeline} />
        </div>
      </section>

      {ticket.status === 'เสร็จสิ้น' && signoffCard}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="ticket-problem-title">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
                <CircleHelp className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary-600">Problem details</p>
                <h3 id="ticket-problem-title" className="text-base font-bold text-slate-900">รายละเอียดปัญหา</h3>
              </div>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-600">{ticket.description}</p>

            <div className={`mt-5 rounded-xl border p-4 ${ticket.resolution ? 'border-emerald-200 bg-emerald-50/70' : 'border-slate-200 bg-slate-50/80'}`}>
              <div className="flex items-start gap-3">
                <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${ticket.resolution ? 'text-emerald-600' : 'text-slate-400'}`} aria-hidden="true" />
                <div>
                  <p className="text-sm font-bold text-slate-800">ผลการดำเนินการ</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                    {ticket.resolution ?? 'ทีม IT จะบันทึกผลการแก้ไขไว้ที่นี่เมื่อดำเนินการเรียบร้อย'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <TicketConversation
            messages={conversation}
            locked={CONVERSATION_LOCKED_STATUSES.includes(ticket.status)}
            onSendMessage={onSendMessage}
          />

          <TicketTimeline worklogs={timeline} />
        </div>

        <aside className="min-w-0 space-y-4" aria-label="ข้อมูลประกอบ Ticket">
          {ticket.status !== 'เสร็จสิ้น' && signoffCard}
          <TicketAttachments attachments={detail.attachments ?? []} />
        </aside>
      </div>
    </div>
  );
}

function CurrentTicketStatus({ status, updatedAt }: { status: TicketStatus; updatedAt: string }) {
  const guidance = getStatusGuidance(status);
  const tone = ticketStatusTone[status];
  const style = STATUS_TONE_STYLES[tone];
  const StatusIcon = guidance.icon;

  return (
    <section className={`rounded-2xl border p-4 sm:p-5 ${style.panel}`} aria-labelledby="current-ticket-status" data-testid="public-current-status">
      <div className="flex items-start gap-3 sm:gap-4">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-sm ${style.icon}`}>
          <StatusIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">สถานะล่าสุด</p>
              <h3 id="current-ticket-status" className="mt-0.5 text-lg font-bold text-slate-900">{ticketStatusLabel[status]}</h3>
            </div>
            <time dateTime={updatedAt} className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> อัปเดต {formatTicketDate(updatedAt)}
            </time>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{guidance.description}</p>
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-white/80 px-3 py-2.5 text-xs leading-5 text-slate-600">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
            <p><span className="font-bold text-slate-700">ขั้นต่อไป:</span> {guidance.next}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function TicketStatusFlow({ status, worklogs }: { status: TicketStatus; worklogs: TrackedTicket['worklogs'] }) {
  const currentIndex = getTicketFlowIndex(status, worklogs);
  const interrupted = isTicketFlowInterrupted(status);

  return (
    <section aria-labelledby="ticket-flow-title">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary-600">Service flow</p>
          <h3 id="ticket-flow-title" className="text-base font-bold text-slate-900">ลำดับการดำเนินงาน</h3>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">5 ขั้นตอน</span>
      </div>

      <ol className="grid grid-cols-1 sm:grid-cols-5" aria-label="ลำดับสถานะงาน">
        {TICKET_FLOW_STEPS.map((step, index) => {
          const reached = index <= currentIndex;
          const current = index === currentIndex;
          const completed = index < currentIndex;
          const style = TICKET_FLOW_STEP_STYLES[index];
          const StepIcon = style.icon;
          return (
            <li
              key={step.label}
              aria-current={current ? 'step' : undefined}
              className={`relative grid grid-cols-[48px_minmax(0,1fr)] gap-3 pb-5 after:absolute after:bottom-0 after:left-[23px] after:top-12 after:w-0.5 after:content-[''] last:pb-0 last:after:hidden sm:block sm:px-1 sm:pb-0 sm:text-center sm:after:bottom-auto sm:after:left-[calc(50%+24px)] sm:after:right-[calc(-50%+24px)] sm:after:top-6 sm:after:h-0.5 sm:after:w-auto ${index < currentIndex ? 'after:bg-primary-300' : 'after:bg-slate-200'}`}
            >
              <span
                className={`relative z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 text-sm font-extrabold shadow-sm sm:mx-auto ${reached ? style.reachedClass : 'border-slate-200 bg-white text-slate-400'} ${current ? `ring-4 ${style.ringClass}` : ''}`}
                aria-hidden="true"
              >
                {completed ? <Check className="h-5 w-5" /> : current ? <StepIcon className="h-5 w-5" /> : index + 1}
              </span>
              <div className="pt-0.5 sm:mt-3 sm:px-1">
                <p className={`text-sm font-bold ${reached ? 'text-slate-800' : 'text-slate-400'}`}>{step.label}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{step.description}</p>
                <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${current ? 'bg-primary-100 text-primary-700' : completed ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                  {current ? 'ขั้นตอนปัจจุบัน' : completed ? 'เสร็จแล้ว' : 'ขั้นถัดไป'}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {interrupted && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-700" role="note">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>Flow ปกติหยุดที่ขั้น “{TICKET_FLOW_STEPS[currentIndex]?.label ?? TICKET_FLOW_STEPS[0].label}” เนื่องจากสถานะปัจจุบันคือ {ticketStatusLabel[status]}</p>
        </div>
      )}
    </section>
  );
}

/** ผู้แจ้งอยู่ฝั่งขวา ทีม IT อยู่ฝั่งซ้าย — ข้อความที่ไม่มี actor ผูกอยู่คือของผู้แจ้งเอง */
function messageFromRequester(log: TrackedTicket['worklogs'][number]): boolean {
  return Boolean(log.actor_line_user_id) || (!log.actor_id && !log.actor?.full_name);
}

/**
 * ห้องสนทนาระหว่างผู้แจ้งกับช่างผู้ดำเนินการบนใบงานเดียวกัน — ข้อความถูกเก็บเป็น worklog
 * สาธารณะ ทีม IT จึงเห็นในหน้า Ticket ของระบบหลังบ้านทันทีโดยไม่ต้องมีกล่องข้อความแยก
 */
function TicketConversation({
  messages,
  locked,
  onSendMessage,
}: {
  messages: TrackedTicket['worklogs'];
  locked: boolean;
  onSendMessage: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await onSendMessage(trimmed);
      setMessage('');
    } catch (error) {
      setSendError(error instanceof ApiError ? error.message : 'ส่งข้อความไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="ticket-conversation-title" data-testid="public-ticket-conversation">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary-600">Conversation</p>
            <h3 id="ticket-conversation-title" className="text-base font-bold text-slate-900">ข้อความถึงช่างผู้ดำเนินการ</h3>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">{messages.length} ข้อความ</span>
      </div>

      {messages.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs leading-5 text-slate-500">
          ยังไม่มีข้อความ — ส่งข้อมูลเพิ่มเติมหรือสอบถามความคืบหน้าได้ที่นี่ ช่างผู้ดำเนินการจะเห็นข้อความบนใบงานเดียวกัน
        </p>
      ) : (
        <ul className="mt-5 flex flex-col gap-3" aria-label="บทสนทนากับช่างผู้ดำเนินการ">
          {messages.map((log, index) => {
            const mine = messageFromRequester(log);
            return (
              <li key={log.id ?? `${log.created_at}-${index}`} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                <span className="text-[10px] text-slate-500">
                  {mine ? 'ท่าน' : `${log.actor?.full_name ?? 'ทีม IT'} · ช่างผู้ดำเนินการ`} · {formatTicketDate(log.created_at)}
                </span>
                <span
                  className={`mt-1 max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-6 ${
                    mine ? 'bg-primary-700 text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {log.detail ?? log.action}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {locked ? (
        <p className="mt-5 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          Ticket นี้ปิดแล้ว จึงไม่รับข้อความเพิ่ม หากยังพบปัญหากรุณาแจ้งเรื่องใหม่
        </p>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="mt-5 flex items-end gap-2">
          <label htmlFor="public-ticket-message" className="sr-only">พิมพ์ข้อความถึงช่างผู้ดำเนินการ</label>
          <textarea
            id="public-ticket-message"
            className={`${INPUT} min-h-11 flex-1 resize-none`}
            rows={2}
            value={message}
            maxLength={1000}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="พิมพ์ข้อความ..."
          />
          <button
            type="submit"
            disabled={sending || message.trim().length === 0}
            className={`${PRIMARY_BUTTON} h-11 w-11 shrink-0 !px-0`}
            aria-label="ส่งข้อความ"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          </button>
        </form>
      )}
      {sendError && <p className="mt-2 text-xs text-rose-700" role="alert">{sendError}</p>}
    </section>
  );
}

function TicketTimeline({ worklogs }: { worklogs: TrackedTicket['worklogs'] }) {
  return (
    <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="ticket-timeline-title">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-700">
          <History className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-purple-600">Timeline</p>
          <h3 id="ticket-timeline-title" className="text-base font-bold text-slate-900">ประวัติการดำเนินงาน</h3>
        </div>
      </div>

      {worklogs.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
          <Clock3 className="mx-auto h-6 w-6 text-slate-300" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-slate-600">ยังไม่มีอัปเดตเพิ่มเติม</p>
          <p className="mt-1 text-xs text-slate-500">เมื่อทีม IT ดำเนินการ รายละเอียดจะแสดงเรียงตามเวลาในส่วนนี้</p>
        </div>
      ) : (
        <ol className="mt-5" aria-label="ประวัติการอัปเดต Ticket">
          {worklogs.map((log, index) => {
            const statusForTone = log.status_to ?? log.status_from;
            const dotClass = statusForTone ? STATUS_TONE_STYLES[ticketStatusTone[statusForTone]].dot : 'bg-slate-400';
            return (
              <li key={`${log.created_at}-${index}`} className="relative pb-6 pl-10 last:pb-0">
                {index < worklogs.length - 1 && <span className="absolute bottom-0 left-[15px] top-7 w-0.5 bg-slate-200" aria-hidden="true" />}
                <span className={`absolute left-2 top-1 h-4 w-4 rounded-full border-4 border-white shadow-sm ${dotClass}`} aria-hidden="true" />
                <time dateTime={log.created_at} className="text-[11px] font-medium text-slate-500">{formatTicketDate(log.created_at)}</time>
                <p className="mt-1 text-sm font-bold text-slate-800">{log.action}</p>
                {log.status_to && (
                  <div className="mt-2 flex flex-wrap items-center gap-2" aria-label="การเปลี่ยนสถานะ">
                    {log.status_from && <Badge variant={ticketStatusTone[log.status_from]}>{ticketStatusLabel[log.status_from]}</Badge>}
                    {log.status_from && <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />}
                    <Badge variant={ticketStatusTone[log.status_to]}>{ticketStatusLabel[log.status_to]}</Badge>
                  </div>
                )}
                {log.detail && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">{log.detail}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function TicketAttachments({ attachments }: { attachments: TrackedTicket['attachments'] }) {
  return (
    <section className={`${CARD} p-5`} aria-labelledby="ticket-attachments-title">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileImage className="h-4 w-4 text-primary-600" aria-hidden="true" />
          <h3 id="ticket-attachments-title" className="text-sm font-bold text-slate-800">ไฟล์แนบ</h3>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">{attachments.length} ไฟล์</span>
      </div>

      {attachments.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500">ไม่มีไฟล์แนบใน Ticket นี้</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {attachments.map((attachment) => {
            const fileContent = (
              <>
                {attachment.mime_type.startsWith('image/') && attachment.signed_url && <img src={attachment.signed_url} alt={attachment.original_filename} className="mb-3 h-32 w-full rounded-lg object-cover" />}
                <span className="block truncate text-xs font-bold text-slate-700">{attachment.original_filename}</span>
                <span className="mt-1 block text-[11px] text-slate-500">{(attachment.size_bytes / (1024 * 1024)).toFixed(1)} MB</span>
              </>
            );
            return attachment.signed_url ? (
              <a key={attachment.id} href={attachment.signed_url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-200 p-3 hover:border-primary-300 hover:bg-primary-50/40">
                {fileContent}
              </a>
            ) : (
              <div key={attachment.id} className="rounded-xl border border-slate-200 p-3 opacity-60" aria-disabled="true">
                {fileContent}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LineTicketList({
  profileName,
  tickets,
  loading,
  onOpen,
  onReport,
}: {
  profileName: string;
  tickets: LineTicketSummary[] | null;
  loading: boolean;
  onOpen: (id: string) => Promise<void>;
  onReport: () => void;
}) {
  return (
    <section className={`${CARD} overflow-hidden`} aria-labelledby="line-ticket-list-title">
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-gradient-to-r from-white to-primary-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="public-line-button flex h-10 w-10 shrink-0 items-center justify-center">
            <MessageCircle className="h-5 w-5 fill-current" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="line-ticket-list-title" className="font-bold text-slate-900">รายการแจ้งซ่อมของฉัน</h2>
              {tickets && <span className="rounded-full bg-primary-100 px-2.5 py-1 text-[10px] font-bold text-primary-700">{tickets.length} รายการ</span>}
            </div>
            <p className="mt-1 text-xs text-slate-500">เข้าสู่ระบบด้วย LINE · {profileName}</p>
          </div>
        </div>
        <button type="button" onClick={onReport} className="public-line-button inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-bold">
          <Wrench className="h-4 w-4" aria-hidden="true" /> แจ้งซ่อมใหม่
        </button>
      </div>

      {tickets === null ? (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500" role="status"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />กำลังโหลดรายการ</div>
      ) : tickets.length === 0 ? (
        <div className="p-10 text-center">
          <TicketCheck className="mx-auto h-9 w-9 text-slate-300" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-slate-600">ยังไม่มีรายการแจ้งซ่อมผ่านบัญชี LINE นี้</p>
          <button type="button" onClick={onReport} className="mt-3 text-sm font-bold text-primary-700 hover:underline">เริ่มแจ้งปัญหา</button>
        </div>
      ) : (
        <ul className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="รายการแจ้งซ่อม">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <button
                type="button"
                disabled={loading}
                onClick={() => void onOpen(ticket.id)}
                aria-label={`เปิดรายละเอียด ${ticket.ticket_no} ${ticket.title}`}
                className="group flex min-h-[190px] w-full flex-col rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md disabled:cursor-wait disabled:opacity-60"
              >
                <div className="flex w-full items-start justify-between gap-3">
                  <span className="font-mono text-[11px] font-bold text-primary-700">{ticket.ticket_no}</span>
                  <Badge variant={ticketStatusTone[ticket.status]}>{ticketStatusLabel[ticket.status]}</Badge>
                </div>
                <p className="mt-3 line-clamp-2 text-sm font-bold leading-6 text-slate-800">{ticket.title}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1">{ticket.category?.name ?? 'ไม่ระบุประเภท'}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1">เร่งด่วน {ticket.priority}</span>
                </div>
                <div className="mt-auto flex w-full items-center justify-between gap-3 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{formatTicketDate(ticket.created_at)}</span>
                  <ChevronRight className="h-4 w-4 text-primary-600 transition group-hover:translate-x-0.5" aria-hidden="true" />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GuestTicketLookup({
  saved,
  ticketId,
  token,
  loading,
  error,
  onTicketIdChange,
  onTokenChange,
  onLookup,
}: {
  saved: SavedTicket[];
  ticketId: string;
  token: string;
  loading: boolean;
  error: string | null;
  onTicketIdChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onLookup: (id: string, token: string) => Promise<void>;
}) {
  return (
    <section className={`${CARD} overflow-hidden`} aria-labelledby="ticket-lookup-title">
      <div className="grid lg:grid-cols-[0.82fr_1.18fr]">
        <div className="bg-gradient-to-br from-primary-950 via-primary-900 to-primary-700 p-5 sm:p-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-white">
            <PackageSearch className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.14em] text-accent-300">Track a ticket</p>
          <h2 id="ticket-lookup-title" className="mt-1 !text-xl font-bold !text-white">ค้นหาสถานะด้วยรหัสติดตาม</h2>
          <p className="mt-2 text-sm leading-6 text-primary-100">ใช้ข้อมูล 2 รายการที่ได้รับหลังแจ้งซ่อม เพื่อเปิดดูความคืบหน้าอย่างปลอดภัย</p>

          <ol className="mt-6 space-y-4" aria-label="วิธีค้นหาสถานะ Ticket">
            {[
              ['1', 'กรอกเลข Ticket', 'ตัวอย่าง TCK-2026-0001'],
              ['2', 'กรอกรหัสติดตาม', 'รหัส 12 ตัวที่ได้รับหลังส่งเรื่อง'],
              ['3', 'ดู flow และอัปเดต', 'ตรวจสอบขั้นตอน ผลดำเนินการ และไฟล์แนบ'],
            ].map(([number, title, description]) => (
              <li key={number} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/15 text-xs font-extrabold text-white">{number}</span>
                <div>
                  <p className="text-sm font-bold text-white">{title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-primary-100">{description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-3 rounded-xl border border-primary-100 bg-primary-50 px-3.5 py-3 text-xs leading-5 text-primary-800">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>เพื่อปกป้องรายละเอียดและไฟล์แนบ ต้องใช้เลข Ticket คู่กับรหัสติดตาม หรือเข้าสู่ระบบด้วย LINE</p>
          </div>

          {saved.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-xs font-bold text-slate-600">Ticket ที่บันทึกไว้ในเครื่องนี้</p>
              <ul className="grid gap-2 sm:grid-cols-2" aria-label="Ticket ที่บันทึกในเครื่องนี้">
                {saved.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => void onLookup(row.ticketNo ?? row.id, row.trackingToken)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-600 hover:border-primary-300 hover:bg-primary-50"
                    >
                      <span className="truncate font-mono">{row.ticketNo ?? row.id}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form onSubmit={(event) => { event.preventDefault(); void onLookup(ticketId.trim(), token.trim()); }} className="mt-5 space-y-4" data-testid="public-ticket-code-search">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={LABEL} htmlFor="ticketId">เลข Ticket</label>
                <input id="ticketId" className={INPUT} value={ticketId} onChange={(event) => onTicketIdChange(event.target.value)} required placeholder="เช่น TCK-2026-0001" autoComplete="off" />
              </div>
              <div>
                <label className={LABEL} htmlFor="token">รหัสติดตาม</label>
                <input id="token" className={INPUT} value={token} onChange={(event) => onTokenChange(event.target.value)} required maxLength={64} placeholder="เช่น ABCD-EFGH-JKLM" autoComplete="off" />
              </div>
            </div>
            <p className="text-[11px] leading-5 text-slate-500">รหัสติดตามแสดงหลังส่งแจ้งซ่อมสำเร็จ และระบบจะบันทึกไว้ในเครื่องที่ใช้แจ้งให้อัตโนมัติ</p>
            {error && <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{error}</div>}
            <button type="submit" disabled={loading} className={`${PRIMARY_BUTTON} w-full`}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
              ตรวจสอบสถานะ
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function getStatusGuidance(status: TicketStatus): { icon: typeof TicketCheck; description: string; next: string } {
  switch (status) {
    case 'ใหม่':
      return { icon: TicketCheck, description: 'ระบบรับข้อมูลการแจ้งซ่อมและสร้างเลข Ticket เรียบร้อยแล้ว', next: 'ทีม IT จะตรวจสอบรายละเอียดและรับเรื่องเข้าคิวดำเนินการ' };
    case 'รับเรื่องแล้ว':
      return { icon: ClipboardList, description: 'ทีม IT ตรวจสอบข้อมูลเบื้องต้นและรับเรื่องไว้ดูแลแล้ว', next: 'เจ้าหน้าที่จะวิเคราะห์สาเหตุ มอบหมายงาน และเริ่มดำเนินการ' };
    case 'กำลังดำเนินการ':
      return { icon: Wrench, description: 'เจ้าหน้าที่กำลังตรวจสอบหรือแก้ไขปัญหาตามรายละเอียดที่แจ้ง', next: 'รอผลการแก้ไขหรือข้อความอัปเดตจากทีม IT' };
    case 'รออะไหล่':
      return { icon: PackageSearch, description: 'การแก้ไขจำเป็นต้องใช้อะไหล่หรืออุปกรณ์เพิ่มเติม', next: 'ทีม IT จะดำเนินการต่อทันทีเมื่อได้รับอะไหล่' };
    case 'รอผู้ใช้งาน':
      return { icon: MessageCircle, description: 'ทีม IT ต้องการข้อมูล การทดสอบ หรือการตอบกลับจากผู้แจ้ง', next: 'ตรวจสอบข้อความอัปเดตและติดต่อทีม IT เพื่อให้งานดำเนินต่อ' };
    case 'ส่งต่อ Outsource':
      return { icon: LifeBuoy, description: 'Ticket ถูกส่งต่อให้ผู้ให้บริการภายนอกที่เกี่ยวข้องดำเนินการ', next: 'ทีม IT จะติดตามผู้ให้บริการและอัปเดตผลใน Timeline' };
    case 'เสร็จสิ้น':
      return { icon: CheckCircle2, description: 'ทีม IT บันทึกผลการแก้ไขแล้ว และรอผู้แจ้งตรวจสอบผล', next: 'ทดสอบการใช้งาน ประเมินบริการ และลงนามเพื่อยืนยันปิดงาน' };
    case 'ปิดงาน':
      return { icon: ShieldCheck, description: 'ผู้แจ้งยืนยันผลและ Ticket ถูกปิดเรียบร้อยแล้ว', next: 'ไม่ต้องดำเนินการเพิ่มเติม สามารถย้อนดูประวัติได้ทุกเวลา' };
    case 'ยกเลิก':
      return { icon: AlertTriangle, description: 'Ticket นี้ถูกยกเลิกและหยุดการดำเนินงานแล้ว', next: 'ดูเหตุผลใน Timeline หรือแจ้งเรื่องใหม่หากยังพบปัญหา' };
    case 'ยกระดับเป็น Incident':
      return { icon: AlertTriangle, description: 'ปัญหาถูกยกระดับไปจัดการในกระบวนการ Incident', next: 'ทีม IT จะติดตามผลผ่าน Incident และแจ้งความคืบหน้าที่เกี่ยวข้อง' };
  }
}

function formatTicketDate(value: string) {
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function ErrorCard({ message }: { message: string }) {
  return <div className={`${CARD} flex items-center gap-2 p-5 text-sm text-red-700`} role="alert"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /><span>{message}</span></div>;
}
