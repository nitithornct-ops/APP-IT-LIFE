import { Bell, Inbox, Plus, QrCode } from 'lucide-react';
import { cn } from '../../utils/cn';
import { LineEmptyState, LineSectionHeading } from './LinePortalChrome';
import { LineTicketCard } from './LineTicketCard';
import { activeLineTickets, countLineTickets } from './ticketGroups';
import type { LinePortalProfile, LineTicketSummary } from './types';

const HOME_TICKET_LIMIT = 3;

/** สรุปสามช่องบนหน้าแรก กดแล้วเปิดรายการที่กรองไว้แล้ว ไม่ใช่ตัวเลขที่กดไม่ได้ */
const STAT_CARDS: Array<{ key: 'open' | 'awaiting' | 'closed'; label: string; barClass: string; valueClass: string }> = [
  { key: 'open', label: 'กำลังดำเนินการ', barClass: 'bg-primary-600', valueClass: 'text-primary-700 dark:text-primary-300' },
  { key: 'awaiting', label: 'รอท่านยืนยัน', barClass: 'bg-warning-600', valueClass: 'text-warning-700 dark:text-warning-600' },
  { key: 'closed', label: 'ปิดงานแล้ว', barClass: 'bg-success-600', valueClass: 'text-success-700 dark:text-success-600' },
];

export function LineHomeTab({ profile, tickets, unreadCount, onNewTicket, onScanAsset, onOpenTicket, onSeeAll, onOpenNotifications }: {
  profile: LinePortalProfile;
  tickets: LineTicketSummary[];
  unreadCount: number;
  onNewTicket: () => void;
  onScanAsset: () => void;
  onOpenTicket: (id: string) => void;
  onSeeAll: (group: 'open' | 'awaiting' | 'closed' | 'all') => void;
  onOpenNotifications: () => void;
}) {
  const counts = countLineTickets(tickets);
  const followUp = activeLineTickets(tickets);

  return (
    <div className="flex flex-col gap-4 pb-4">
      <header className="bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 px-4 pb-5 pt-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-200">LIFE IT · Service Desk</p>
            <h1 className="mt-2 truncate text-lg font-bold">สวัสดี คุณ{profile.fullName || profile.displayName || 'ผู้ใช้งาน'}</h1>
            <p className="mt-0.5 truncate text-xs text-primary-200">
              {[profile.department, 'แจ้งซ่อมและติดตามงานผ่าน LINE'].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenNotifications}
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            aria-label={unreadCount > 0 ? `การแจ้งเตือน ${unreadCount} รายการที่ยังไม่ได้อ่าน` : 'การแจ้งเตือน'}
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[9px] font-bold" aria-hidden="true">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={onNewTicket}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-card bg-primary-600 px-4 py-3 text-sm font-bold text-white shadow-action transition hover:bg-primary-500"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> แจ้งซ่อม / เปิด Ticket ใหม่
        </button>
      </header>

      <div className="grid grid-cols-3 gap-2 px-4">
        {STAT_CARDS.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => onSeeAll(card.key)}
            aria-label={`${card.label} ${counts[card.key]} รายการ`}
            className="rounded-card border border-hairline bg-white px-2 py-3 text-center shadow-card transition hover:border-primary-300 dark:border-slate-700 dark:bg-slate-900"
          >
            <p className={cn('text-2xl font-extrabold leading-none', card.valueClass)}>{counts[card.key]}</p>
            <p className="mt-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">{card.label}</p>
            <span className={cn('mx-auto mt-2 block h-0.5 w-8 rounded-full', card.barClass)} aria-hidden="true" />
          </button>
        ))}
      </div>

      <section className="px-4">
        <LineSectionHeading
          title="Ticket ที่ต้องติดตาม"
          action={followUp.length > 0 && (
            <button type="button" onClick={() => onSeeAll('all')} className="public-link text-xs">ดูทั้งหมด →</button>
          )}
        />
        {followUp.length === 0 ? (
          <LineEmptyState
            icon={Inbox}
            title="ไม่มีงานค้างอยู่"
            description="เมื่อมี Ticket ที่ทีม IT กำลังดำเนินการหรือรอท่านยืนยัน จะขึ้นที่นี่"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {followUp.slice(0, HOME_TICKET_LIMIT).map((ticket) => (
              <li key={ticket.id}><LineTicketCard ticket={ticket} onOpen={onOpenTicket} /></li>
            ))}
          </ul>
        )}
      </section>

      <section className="px-4">
        <button
          type="button"
          onClick={onScanAsset}
          className="flex w-full items-start gap-3 rounded-card border border-primary-200 bg-primary-50 p-3.5 text-left transition hover:border-primary-300 dark:border-primary-800 dark:bg-primary-900/30"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white">
            <QrCode className="h-4 w-4" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-bold text-primary-900 dark:text-primary-100">แจ้งซ่อมด้วยรหัสทรัพย์สิน</span>
            <span className="mt-0.5 block text-[11px] leading-5 text-primary-800 dark:text-primary-200">
              กรอกรหัสที่ติดอยู่บนตัวเครื่อง ระบบจะผูก Ticket กับอุปกรณ์ให้อัตโนมัติ ทีม IT จะรู้ทันทีว่าเป็นเครื่องไหน
            </span>
          </span>
        </button>
      </section>
    </div>
  );
}
