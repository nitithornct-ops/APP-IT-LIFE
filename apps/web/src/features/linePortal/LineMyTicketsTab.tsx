import { ClipboardList } from 'lucide-react';
import { cn } from '../../utils/cn';
import { LineEmptyState } from './LinePortalChrome';
import { LineTicketCard } from './LineTicketCard';
import { lineTicketGroup, type LineTicketGroup } from './ticketGroups';
import type { LineTicketSummary } from './types';

export type LineTicketFilter = LineTicketGroup | 'all';

const FILTERS: Array<{ key: LineTicketFilter; label: string }> = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'open', label: 'กำลังดำเนินการ' },
  { key: 'awaiting', label: 'รอยืนยัน' },
  { key: 'closed', label: 'ปิดแล้ว' },
];

const EMPTY_TEXT: Record<LineTicketFilter, string> = {
  all: 'ยังไม่มี Ticket ที่แจ้งผ่านบัญชีนี้',
  open: 'ไม่มี Ticket ที่กำลังดำเนินการ',
  awaiting: 'ไม่มี Ticket ที่รอท่านยืนยัน',
  closed: 'ยังไม่มี Ticket ที่ปิดงานแล้ว',
};

export function LineMyTicketsTab({ tickets, filter, onFilterChange, onOpenTicket }: {
  tickets: LineTicketSummary[];
  filter: LineTicketFilter;
  onFilterChange: (filter: LineTicketFilter) => void;
  onOpenTicket: (id: string) => void;
}) {
  const visible = filter === 'all' ? tickets : tickets.filter((ticket) => lineTicketGroup(ticket.status) === filter);

  return (
    <div className="flex flex-col pb-4">
      <header className="sticky top-0 z-20 border-b border-hairline bg-white/95 px-4 pb-2 pt-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <h1 className="text-sm font-bold text-slate-900 dark:text-slate-100">งานของฉัน</h1>
        <div className="-mx-1 mt-2 flex gap-1 overflow-x-auto" role="tablist" aria-label="กรองตามสถานะ">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => onFilterChange(key)}
              className={cn(
                'whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition',
                filter === key
                  ? 'bg-primary-700 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="px-4 pt-3">
        {visible.length === 0 ? (
          <LineEmptyState icon={ClipboardList} title={EMPTY_TEXT[filter]} description="เปิด Ticket ใหม่ได้จากปุ่มแจ้งซ่อมบนหน้าแรก" />
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {visible.map((ticket) => (
                <li key={ticket.id}><LineTicketCard ticket={ticket} onOpen={onOpenTicket} /></li>
              ))}
            </ul>
            <p className="mt-3 text-center text-[11px] text-slate-400 dark:text-slate-500">
              แสดง {visible.length} รายการ · เรียงจากใหม่ไปเก่า
            </p>
          </>
        )}
      </div>
    </div>
  );
}
