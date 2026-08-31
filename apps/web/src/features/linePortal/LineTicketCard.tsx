import { ChevronRight } from 'lucide-react';
import { SlaBadge } from '../../components/ui/SlaBadge';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ticketSlaBadge, ticketStatusLabel, ticketStatusTone } from '../tickets/ticketDisplay';
import { relativeThaiTime } from './lineTime';
import { lineTicketGroup } from './ticketGroups';
import type { LineTicketSummary } from './types';

/** บรรทัดบริบทใต้หัวข้อ — หมวดหมู่ อุปกรณ์ และผู้รับผิดชอบเท่าที่ใบนั้นมีข้อมูล */
function ticketContextLine(ticket: LineTicketSummary): string {
  return [
    ticket.category?.name,
    ticket.asset_name_snapshot,
    ticket.assignee_name_snapshot ? `${ticket.assignee_name_snapshot} · ทีม IT` : 'ยังไม่ได้มอบหมายผู้รับผิดชอบ',
  ].filter(Boolean).join(' · ');
}

export function LineTicketCard({ ticket, onOpen }: { ticket: LineTicketSummary; onOpen: (id: string) => void }) {
  const sla = ticketSlaBadge(ticket.due_at, ticket.status);
  const group = lineTicketGroup(ticket.status);

  return (
    <button
      type="button"
      onClick={() => onOpen(ticket.id)}
      className="flex w-full items-center gap-3 rounded-card border border-hairline bg-white p-3.5 text-left shadow-card transition hover:border-primary-300 dark:border-slate-700 dark:bg-slate-900"
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[11px] font-bold text-primary-700 dark:text-primary-300">{ticket.ticket_no}</span>
          <StatusBadge display={{ label: ticketStatusLabel[ticket.status], tone: ticketStatusTone[ticket.status] }} />
          <span className="ml-auto">
            {/* ป้ายขวาบนต้องบอกให้ชัดว่าเป็นเวลาอะไร ตัวเลขลอย ๆ อ่านสับสนกับเวลาที่เหลือตาม SLA */}
            {group === 'closed'
              ? <span className="text-[11px] text-slate-400 dark:text-slate-500">ปิดเมื่อ {relativeThaiTime(ticket.closed_at ?? ticket.updated_at ?? ticket.created_at)}</span>
              : <SlaBadge display={sla} fallback={`อัปเดต ${relativeThaiTime(ticket.updated_at ?? ticket.created_at)}`} />}
          </span>
        </span>
        <span className="mt-1.5 line-clamp-2 block text-sm font-bold leading-5 text-slate-900 dark:text-slate-100">{ticket.title}</span>
        <span className="mt-1 line-clamp-1 block text-[11px] text-slate-500 dark:text-slate-400">{ticketContextLine(ticket)}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden="true" />
    </button>
  );
}
