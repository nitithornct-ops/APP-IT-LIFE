import { TICKET_RATING_CRITERIA, type TicketRatingCriterion, type TicketRatingDetails, type TicketRatingSnapshotItem } from '@itlife/shared';
import { AlertTriangle, ArrowLeft, Loader2, LogOut, MessageCircleQuestion, Ticket } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PublicBrand } from '../components/PublicBrand';
import { LineProfileNameForm } from '../components/LineProfileNameForm';
import { RequesterSignoffCard } from '../components/tickets/RequesterSignoffCard';
import { ApiError } from '../services/apiClient';
import { clearLineSessionToken, lineApiFetch } from '../services/lineApiClient';

interface LineBootstrap {
  configured: boolean;
  enabled: boolean;
  message: string;
  authenticated: boolean;
  profile: {
    displayName: string; pictureUrl: string; fullName: string;
    linkStatus: string; friendStatus: string;
  } | null;
}

interface LineTicketSummary {
  id: string; title: string; priority: string; status: string; created_at: string;
}

interface LineTicketDetail {
  ticket: LineTicketSummary & { requester_name_snapshot: string | null; description: string; resolution: string | null; rating: number | null; rating_details: TicketRatingDetails | null; rating_criteria_snapshot: TicketRatingSnapshotItem[] | null; signature_url: string | null; requester_signature_url: string | null; requester_signature_uploaded_at: string | null; category: { name: string } | null };
  ratingCriteria: TicketRatingCriterion[];
  worklogs: Array<{ action: string; detail: string | null; status_from: string | null; status_to: string | null; created_at: string }>;
}

interface TicketCategory { id: string; name: string; }

type View = 'menu' | 'submit' | 'list' | 'detail';

const CARD = 'public-sheet w-full max-w-md p-5';
const BUTTON_PRIMARY = 'public-primary-button flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60';
const BUTTON_LINE = 'public-line-button flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium disabled:opacity-60';
const BUTTON_SECONDARY = 'public-secondary-button flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium';
const INPUT = 'public-field w-full px-3 py-2 text-sm focus:outline-none';

export function LinePortalPage() {
  const [params] = useSearchParams();
  const [bootstrap, setBootstrap] = useState<LineBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('menu');

  const loadBootstrap = useCallback(async () => {
    try {
      const data = await lineApiFetch<LineBootstrap>('/api/v1/line/bootstrap');
      setBootstrap(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
    const mode = params.get('mode');
    if (mode === 'status') setView('list');
    const callbackError = params.get('error');
    if (callbackError) setError(callbackError);
  }, [loadBootstrap, params]);

  async function startLogin() {
    try {
      const { url } = await lineApiFetch<{ url: string }>(`/api/v1/line/login-url?returnMode=${params.get('mode') === 'status' ? 'status' : 'report'}`);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'เริ่ม LINE Login ไม่สำเร็จ');
    }
  }

  async function logout() {
    try { await lineApiFetch('/api/v1/line/logout', { method: 'POST' }); } catch { /* revoke best-effort */ }
    clearLineSessionToken();
    setBootstrap(null);
    setLoading(true);
    void loadBootstrap();
  }

  if (loading) {
    return (
      <main className="life-public flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
      </main>
    );
  }

  return (
    <main className="life-public flex min-h-screen flex-col items-center justify-center gap-4 p-6">
      <div className="w-full max-w-md border-b border-slate-200 pb-4">
        <PublicBrand subtitle="LINE Service Portal" />
        <h1 className="mt-3 text-base text-slate-800 dark:text-slate-100">แจ้งซ่อม LIFE IT ผ่าน LINE</h1>
      </div>

      {error && (
        <div className="flex w-full max-w-md items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {!bootstrap?.configured ? (
        <div className={CARD}>
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            {bootstrap?.message || 'ระบบ LINE Login ยังไม่พร้อมใช้งาน กรุณาติดต่อส่วนงาน IT'}
          </p>
        </div>
      ) : !bootstrap.authenticated ? (
        <div className={CARD}>
          <p className="mb-4 text-center text-sm text-slate-600 dark:text-slate-300">
            เข้าสู่ระบบด้วยบัญชี LINE เพื่อแจ้งซ่อมและติดตามสถานะได้ทันที
          </p>
          <button type="button" onClick={() => void startLogin()} className={BUTTON_LINE}>
            เข้าสู่ระบบด้วย LINE
          </button>
        </div>
      ) : bootstrap.profile?.linkStatus === 'Suspended' ? (
        <div className={CARD}>
          <p className="text-center text-sm text-red-600 dark:text-red-400">บัญชี LINE นี้ถูกระงับ กรุณาติดต่อส่วนงาน IT</p>
        </div>
      ) : !bootstrap.profile?.fullName.trim() ? (
        <LineProfileNameForm onSaved={(fullName) => setBootstrap((current) => current?.profile ? {
          ...current,
          profile: { ...current.profile, fullName },
        } : current)} />
      ) : view === 'menu' ? (
        <MenuCard profile={bootstrap.profile} onNavigate={setView} onLogout={() => void logout()} />
      ) : view === 'submit' ? (
        <SubmitTicketCard
          profile={bootstrap.profile}
          onProfileSaved={(fullName) => setBootstrap((current) => current?.profile ? { ...current, profile: { ...current.profile, fullName } } : current)}
          onDone={() => setView('list')}
          onBack={() => setView('menu')}
        />
      ) : view === 'list' ? (
        <TicketListCard onSelect={() => setView('detail')} onBack={() => setView('menu')} />
      ) : (
        <div className={CARD}>
          <button type="button" onClick={() => setView('list')} className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> กลับ
          </button>
        </div>
      )}
    </main>
  );
}

function MenuCard({ profile, onNavigate, onLogout }: { profile: LineBootstrap['profile']; onNavigate: (view: View) => void; onLogout: () => void }) {
  return (
    <div className={CARD}>
      <p className="mb-4 text-center text-sm text-slate-600 dark:text-slate-300">สวัสดีคุณ {profile?.fullName}</p>
      <div className="flex flex-col gap-2">
        <button type="button" onClick={() => onNavigate('submit')} className={BUTTON_PRIMARY}>
          <Ticket className="h-4 w-4" aria-hidden="true" /> แจ้งซ่อม
        </button>
        <button type="button" onClick={() => onNavigate('list')} className={BUTTON_SECONDARY}>
          <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" /> สถานะของฉัน
        </button>
        <button type="button" onClick={onLogout} className="mt-2 flex items-center justify-center gap-2 text-sm text-slate-500 hover:underline">
          <LogOut className="h-4 w-4" aria-hidden="true" /> ออกจากระบบ LINE
        </button>
      </div>
    </div>
  );
}

function SubmitTicketCard({ profile, onProfileSaved, onDone, onBack }: {
  profile: NonNullable<LineBootstrap['profile']>;
  onProfileSaved: (fullName: string) => void;
  onDone: () => void;
  onBack: () => void;
}) {
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [fullName, setFullName] = useState(profile.fullName);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFirstAndLastName = fullName.trim().split(/\s+/).length >= 2;

  useEffect(() => {
    void lineApiFetch<TicketCategory[]>('/api/v1/line/ticket-categories').then(setCategories).catch(() => setCategories([]));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const normalizedName = fullName.trim().replace(/\s+/g, ' ');
      if (normalizedName !== profile.fullName) {
        await lineApiFetch('/api/v1/line/profile', { method: 'PATCH', body: JSON.stringify({ fullName: normalizedName }) });
        onProfileSaved(normalizedName);
      }
      await lineApiFetch('/api/v1/line/tickets', { method: 'POST', body: JSON.stringify({ title, categoryId, description, privacyConsent }) });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ส่ง Ticket ไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className={CARD}>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> กลับ
      </button>
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor="requester-name" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">ชื่อ–นามสกุลผู้แจ้ง</label>
          <input id="requester-name" className={INPUT} value={fullName} onChange={(event) => setFullName(event.target.value)} required minLength={3} maxLength={160} autoComplete="name" />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">ใช้ชื่อจริงสำหรับใบแจ้งซ่อมและการลงนาม ไม่ใช้ชื่อโปรไฟล์ LINE ({profile.displayName || '-'})</p>
        </div>
        <div>
          <label htmlFor="title" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">หัวข้อปัญหา</label>
          <input id="title" className={INPUT} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} />
        </div>
        <div>
          <label htmlFor="category" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">หมวดหมู่</label>
          <select id="category" className={INPUT} value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
            <option value="">เลือกหมวดหมู่</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="description" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">รายละเอียด</label>
          <textarea id="description" className={INPUT} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} required maxLength={3000} />
        </div>
        <label className="flex items-start gap-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={privacyConsent} onChange={(event) => setPrivacyConsent(event.target.checked)} required className="mt-0.5 h-4 w-4" />
          <span>ยอมรับการใช้ข้อมูลเพื่อรับเรื่อง ติดต่อกลับ ดำเนินการแจ้งซ่อม และแจ้งสถานะ Ticket</span>
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button type="submit" disabled={submitting || !privacyConsent || !hasFirstAndLastName} className={BUTTON_PRIMARY}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} ส่ง Ticket
        </button>
      </div>
    </form>
  );
}

function TicketListCard({ onSelect, onBack }: { onSelect: (id: string) => void; onBack: () => void }) {
  const [tickets, setTickets] = useState<LineTicketSummary[] | null>(null);
  const [detail, setDetail] = useState<LineTicketDetail | null>(null);

  useEffect(() => {
    void lineApiFetch<LineTicketSummary[]>('/api/v1/line/tickets').then(setTickets).catch(() => setTickets([]));
  }, []);

  async function openDetail(id: string) {
    try {
      const data = await lineApiFetch<LineTicketDetail>(`/api/v1/line/tickets/${id}`);
      setDetail(data);
      onSelect(id);
    } catch {
      /* stay on list if detail fails to load */
    }
  }

  async function signoff(file: File, ratings: TicketRatingDetails, feedback?: string) {
    if (!detail) return;
    const body = new FormData();
    body.set('file', file);
    body.set('ratings', JSON.stringify(ratings));
    if (feedback) body.set('feedback', feedback);
    await lineApiFetch(`/api/v1/line/tickets/${detail.ticket.id}/signoff`, { method: 'POST', body });
    setDetail(await lineApiFetch<LineTicketDetail>(`/api/v1/line/tickets/${detail.ticket.id}`));
    setTickets(await lineApiFetch<LineTicketSummary[]>('/api/v1/line/tickets'));
  }

  if (detail) return <TicketDetailCard detail={detail} onSignoff={signoff} onBack={() => setDetail(null)} />;

  return (
    <div className={CARD}>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> กลับ
      </button>
      {tickets === null ? (
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
      ) : tickets.length === 0 ? (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">ยังไม่มี Ticket ที่แจ้งผ่าน LINE</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <button type="button" onClick={() => void openDetail(ticket.id)} className="w-full rounded-md border border-slate-200 p-3 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700">
                <p className="font-medium text-slate-800 dark:text-slate-100">{ticket.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{ticket.status} · {ticket.priority}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TicketDetailCard({ detail, onSignoff, onBack }: { detail: LineTicketDetail; onSignoff: (file: File, ratings: TicketRatingDetails, feedback?: string) => Promise<void>; onBack: () => void }) {
  const ratingBreakdown = detail.ticket.rating_criteria_snapshot?.length
    ? detail.ticket.rating_criteria_snapshot
    : TICKET_RATING_CRITERIA.flatMap((criterion) => {
      const score = detail.ticket.rating_details?.[criterion.key];
      return score === undefined ? [] : [{ key: criterion.key, label: criterion.label, score }];
    });

  return (
    <div className={CARD}>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> กลับ
      </button>
      <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{detail.ticket.title}</h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{detail.ticket.status} · {detail.ticket.category?.name ?? '-'}</p>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{detail.ticket.description}</p>
      {detail.ticket.resolution && (
        <p className="mt-2 rounded-md bg-slate-50 p-2 text-sm text-slate-600 dark:bg-slate-700 dark:text-slate-300">ผลดำเนินการ: {detail.ticket.resolution}</p>
      )}
      <div className="mt-4">
        <RequesterSignoffCard
          status={detail.ticket.status}
          signatureUrl={detail.ticket.requester_signature_url}
          signedAt={detail.ticket.requester_signature_uploaded_at}
          requesterName={detail.ticket.requester_name_snapshot}
          criteria={detail.ratingCriteria}
          rating={detail.ticket.rating}
          onSign={onSignoff}
        />
      </div>
      <ul className="mt-3 flex flex-col gap-1 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
        {detail.worklogs.map((log, index) => (
          <li key={index}>{log.action}{log.detail ? ` — ${log.detail}` : ''}</li>
        ))}
      </ul>
      {detail.ticket.signature_url && <div className="mt-4 border-t border-slate-100 pt-4 text-center dark:border-slate-700"><p className="mb-2 text-xs font-semibold text-slate-500">ลายเซ็นรับรอง Ticket</p><img src={detail.ticket.signature_url} alt="ลายเซ็นรับรอง Ticket" className="mx-auto max-h-24 max-w-full object-contain" /></div>}
      {detail.ticket.rating != null && (
        <div className="mt-4 border-t border-slate-100 pt-4 text-sm dark:border-slate-700">
          <p className="font-semibold text-slate-700 dark:text-slate-200">ผลประเมินการบริการ: {detail.ticket.rating}/5</p>
          {ratingBreakdown.map((criterion) => (
            <p key={criterion.key} className="mt-1 flex justify-between text-xs text-slate-500"><span>{criterion.label}</span><b>{criterion.score}/5</b></p>
          ))}
        </div>
      )}
    </div>
  );
}
