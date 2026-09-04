import type { TicketRatingDetails } from '@itlife/shared';
import { AlertTriangle, Loader2, ShieldAlert, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LineProfileNameForm } from '../components/LineProfileNameForm';
import { PublicBrand } from '../components/PublicBrand';
import { LineHomeTab } from '../features/linePortal/LineHomeTab';
import { LineKnowledgeTab } from '../features/linePortal/LineKnowledgeTab';
import { LineMyTicketsTab, type LineTicketFilter } from '../features/linePortal/LineMyTicketsTab';
import { LineNewTicketForm } from '../features/linePortal/LineNewTicketForm';
import { LineNotificationsTab } from '../features/linePortal/LineNotificationsTab';
import { LinePortalNav } from '../features/linePortal/LinePortalChrome';
import { LineProfileTab } from '../features/linePortal/LineProfileTab';
import { LineTicketDetail } from '../features/linePortal/LineTicketDetail';
import type {
  LineBootstrap, LineNotification, LinePortalTab, LineTicketCategory, LineTicketDetail as LineTicketDetailData, LineTicketSummary,
} from '../features/linePortal/types';
import { ApiError } from '../services/apiClient';
import { clearLineSessionToken, lineApiFetch } from '../services/lineApiClient';

/** เวลาที่อ่านฟีดแจ้งเตือนล่าสุด เก็บไว้ที่เครื่องผู้ใช้ ระบบหลังบ้านไม่มีสถานะ "อ่านแล้ว" ต่อคน */
const READ_AT_KEY = 'line_portal_notifications_read_at';

type PortalView =
  | { kind: 'tabs' }
  | { kind: 'new'; withAssetCode: boolean }
  | { kind: 'detail'; ticketId: string };

function readStoredReadAt(): string | null {
  try {
    return localStorage.getItem(READ_AT_KEY);
  } catch {
    return null;
  }
}

export function LinePortalPage() {
  const [params] = useSearchParams();
  const [bootstrap, setBootstrap] = useState<LineBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<LinePortalTab>('home');
  const [view, setView] = useState<PortalView>({ kind: 'tabs' });
  const [ticketFilter, setTicketFilter] = useState<LineTicketFilter>('all');

  const [tickets, setTickets] = useState<LineTicketSummary[] | null>(null);
  const [notifications, setNotifications] = useState<LineNotification[]>([]);
  const [categories, setCategories] = useState<LineTicketCategory[]>([]);
  const [detail, setDetail] = useState<LineTicketDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  /** ผลลัพธ์ที่ต้องบอกผู้ใช้ต่อหลังเปลี่ยนจอ เช่น แนบไฟล์ไม่สำเร็จหลังส่ง Ticket แล้ว */
  const [notice, setNotice] = useState<string | null>(null);

  const [lastReadAt, setLastReadAt] = useState<string | null>(readStoredReadAt);
  // cutoff ที่ใช้ระบายสีรายการ ถูกตรึงตอนเปิดแท็บ เพื่อให้ผู้ใช้ยังเห็นว่ารายการไหนเพิ่งเข้ามา
  // แม้ตัวเลขบนกระดิ่งจะถูกล้างไปแล้ว
  const [viewedCutoff, setViewedCutoff] = useState<string | null>(lastReadAt);

  const profile = bootstrap?.profile ?? null;
  const usable = Boolean(bootstrap?.authenticated && profile && profile.linkStatus !== 'Suspended' && profile.fullName.trim());

  const loadBootstrap = useCallback(async () => {
    try {
      setBootstrap(await lineApiFetch<LineBootstrap>('/api/v1/line/bootstrap'));
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTickets = useCallback(async () => {
    try {
      setTickets(await lineApiFetch<LineTicketSummary[]>('/api/v1/line/tickets'));
    } catch {
      setTickets([]);
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      setNotifications(await lineApiFetch<LineNotification[]>('/api/v1/line/notifications'));
    } catch {
      setNotifications([]);
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
    // mode มาจาก returnMode ของ LINE Login — 'report' ใช้ค่าเริ่มต้น (หน้าแรก)
    const mode = params.get('mode');
    if (mode === 'status') setTab('tickets');
    else if (mode === 'kb') setTab('knowledge');
    const callbackError = params.get('error');
    if (callbackError) setError(callbackError);
  }, [loadBootstrap, params]);

  useEffect(() => {
    if (!usable) return;
    void loadTickets();
    void loadNotifications();
    void lineApiFetch<LineTicketCategory[]>('/api/v1/line/ticket-categories').then(setCategories).catch(() => setCategories([]));
  }, [usable, loadTickets, loadNotifications]);

  const unreadCount = useMemo(() => {
    const cutoff = lastReadAt ? new Date(lastReadAt).getTime() : 0;
    return notifications.filter((notification) => new Date(notification.created_at).getTime() > cutoff).length;
  }, [notifications, lastReadAt]);

  function openTab(next: LinePortalTab) {
    if (next === 'notifications') {
      setViewedCutoff(lastReadAt);
      const now = new Date().toISOString();
      setLastReadAt(now);
      try {
        localStorage.setItem(READ_AT_KEY, now);
      } catch {
        /* โหมดส่วนตัวของเบราว์เซอร์อาจเขียนไม่ได้ — ยอมให้ป้ายเด้งซ้ำดีกว่าทำหน้าพัง */
      }
    }
    setTab(next);
    setView({ kind: 'tabs' });
  }

  async function openTicket(ticketId: string) {
    setView({ kind: 'detail', ticketId });
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await lineApiFetch<LineTicketDetailData>(`/api/v1/line/tickets/${ticketId}`));
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : 'เปิด Ticket ไม่สำเร็จ');
      setView({ kind: 'tabs' });
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshDetail(ticketId: string) {
    setDetail(await lineApiFetch<LineTicketDetailData>(`/api/v1/line/tickets/${ticketId}`));
    await loadTickets();
  }

  async function signoff(file: File, ratings: TicketRatingDetails, feedback?: string) {
    if (!detail) return;
    const body = new window.FormData();
    body.set('file', file);
    body.set('ratings', JSON.stringify(ratings));
    if (feedback) body.set('feedback', feedback);
    await lineApiFetch(`/api/v1/line/tickets/${detail.ticket.id}/signoff`, { method: 'POST', body });
    await refreshDetail(detail.ticket.id);
  }

  async function sendMessage(message: string) {
    if (!detail) return;
    await lineApiFetch(`/api/v1/line/tickets/${detail.ticket.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    await refreshDetail(detail.ticket.id);
  }

  async function startLogin() {
    const mode = params.get('mode');
    const returnMode = mode === 'status' || mode === 'kb' ? mode : 'report';
    try {
      const { url } = await lineApiFetch<{ url: string }>(`/api/v1/line/login-url?returnMode=${returnMode}`);
      window.location.href = url;
    } catch (loginError) {
      setError(loginError instanceof ApiError ? loginError.message : 'เริ่ม LINE Login ไม่สำเร็จ');
    }
  }

  async function logout() {
    try {
      await lineApiFetch('/api/v1/line/logout', { method: 'POST' });
    } catch {
      /* เพิกถอน session ฝั่งเซิร์ฟเวอร์แบบ best-effort — ยังไงก็ต้องล้าง token ที่เครื่อง */
    }
    clearLineSessionToken();
    setBootstrap(null);
    setTickets(null);
    setNotifications([]);
    setDetail(null);
    setView({ kind: 'tabs' });
    setTab('home');
    setLoading(true);
    void loadBootstrap();
  }

  return (
    <main className="life-public min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col pb-20">
        {notice && (
          <div className="flex items-start gap-2 border-b border-warning-100 bg-warning-50 px-4 py-2.5 text-[11px] leading-5 text-warning-700" role="status">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="flex-1">{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="shrink-0" aria-label="ปิดข้อความ">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
          </div>
        ) : !usable ? (
          <LineGateScreen bootstrap={bootstrap} error={error} onLogin={() => void startLogin()} onNameSaved={(fullName) => {
            setBootstrap((current) => current?.profile ? { ...current, profile: { ...current.profile, fullName } } : current);
          }} />
        ) : view.kind === 'new' ? (
          <LineNewTicketForm
            profile={profile!}
            categories={categories}
            startWithAssetCode={view.withAssetCode}
            onCancel={() => setView({ kind: 'tabs' })}
            onSubmitted={(ticketId, warning) => { setNotice(warning ?? null); void loadTickets(); void openTicket(ticketId); }}
          />
        ) : view.kind === 'detail' ? (
          detailLoading || !detail ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
            </div>
          ) : (
            <LineTicketDetail
              detail={detail}
              onBack={() => { setView({ kind: 'tabs' }); setDetail(null); }}
              onSign={signoff}
              onSendMessage={sendMessage}
            />
          )
        ) : tab === 'knowledge' ? (
          // แท็บนี้อ่านคลังบทความสาธารณะ ไม่ต้องรอรายการ Ticket โหลดเสร็จ
          <LineKnowledgeTab />
        ) : tickets === null ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
          </div>
        ) : tab === 'home' ? (
          <LineHomeTab
            profile={profile!}
            tickets={tickets}
            unreadCount={unreadCount}
            onNewTicket={() => setView({ kind: 'new', withAssetCode: false })}
            onScanAsset={() => setView({ kind: 'new', withAssetCode: true })}
            onOpenTicket={(id) => void openTicket(id)}
            onSeeAll={(group) => { setTicketFilter(group); setTab('tickets'); }}
            onOpenNotifications={() => openTab('notifications')}
          />
        ) : tab === 'tickets' ? (
          <LineMyTicketsTab
            tickets={tickets}
            filter={ticketFilter}
            onFilterChange={setTicketFilter}
            onOpenTicket={(id) => void openTicket(id)}
          />
        ) : tab === 'notifications' ? (
          <LineNotificationsTab
            notifications={notifications}
            lastReadAt={viewedCutoff}
            onOpenTicket={(id) => void openTicket(id)}
          />
        ) : (
          <LineProfileTab
            profile={profile!}
            onProfileSaved={(fullName) => setBootstrap((current) => current?.profile ? { ...current, profile: { ...current.profile, fullName } } : current)}
            onLogout={() => void logout()}
          />
        )}
      </div>

      {usable && view.kind === 'tabs' && (
        <LinePortalNav tab={tab} unreadCount={unreadCount} onChange={openTab} />
      )}
    </main>
  );
}

/** จอก่อนเข้าใช้งาน — ยังไม่ตั้งค่า LINE, ยังไม่ล็อกอิน, ถูกระงับ หรือยังไม่ได้กรอกชื่อจริง */
function LineGateScreen({ bootstrap, error, onLogin, onNameSaved }: {
  bootstrap: LineBootstrap | null;
  error: string | null;
  onLogin: () => void;
  onNameSaved: (fullName: string) => void;
}) {
  const profile = bootstrap?.profile ?? null;
  const needsName = Boolean(bootstrap?.authenticated && profile && profile.linkStatus !== 'Suspended' && !profile.fullName.trim());

  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 px-5 pb-8 pt-8 text-white">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-200">LIFE IT · Service Desk</p>
        <h1 className="mt-2 text-xl font-bold">แจ้งซ่อมและติดตามงาน IT ผ่าน LINE</h1>
        <p className="mt-1.5 text-xs leading-5 text-primary-200">
          เปิด Ticket ดูความคืบหน้า คุยกับทีม IT และยืนยันปิดงานได้จากหน้าจอเดียว
        </p>
      </header>

      <div className="flex flex-col gap-3 px-4 pt-4">
        {error && (
          <p className="public-notice flex items-center gap-2 px-3 py-2 text-xs" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{error}
          </p>
        )}

        {!bootstrap?.configured ? (
          <div className="public-sheet flex flex-col items-center gap-2 p-5 text-center">
            <ShieldAlert className="h-5 w-5 text-slate-400" aria-hidden="true" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {bootstrap?.message || 'ระบบ LINE Login ยังไม่พร้อมใช้งาน กรุณาติดต่อส่วนงาน IT'}
            </p>
          </div>
        ) : profile?.linkStatus === 'Suspended' ? (
          <div className="public-sheet p-5 text-center">
            <p className="text-sm text-danger-700 dark:text-danger-600">บัญชี LINE นี้ถูกระงับ กรุณาติดต่อส่วนงาน IT</p>
          </div>
        ) : needsName ? (
          <LineProfileNameForm onSaved={onNameSaved} />
        ) : (
          <div className="public-sheet p-5">
            <p className="mb-4 text-center text-sm text-slate-600 dark:text-slate-300">
              เข้าสู่ระบบด้วยบัญชี LINE เพื่อแจ้งซ่อมและติดตามสถานะได้ทันที
            </p>
            <button type="button" onClick={onLogin} className="public-line-button flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold">
              เข้าสู่ระบบด้วย LINE
            </button>
          </div>
        )}

        <div className="mt-2 flex justify-center opacity-70">
          <PublicBrand subtitle="LINE Service Portal" />
        </div>
      </div>
    </div>
  );
}
