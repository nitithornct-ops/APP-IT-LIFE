import { TICKET_RATING_CRITERIA, type TicketRatingDetails } from '@itlife/shared';
import { AlertTriangle, FileText, Headset, Loader2, MessageCircle, Paperclip, Send, Star } from 'lucide-react';
import { useState } from 'react';
import { RequesterInfoCard } from '../../components/tickets/RequesterInfoCard';
import { RequesterSignoffCard } from '../../components/tickets/RequesterSignoffCard';
import { SlaBadge } from '../../components/ui/SlaBadge';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ApiError } from '../../services/apiClient';
import { cn } from '../../utils/cn';
import { ticketSlaBadge, ticketStatusLabel, ticketStatusTone } from '../tickets/ticketDisplay';
import { getTicketFlowIndex, isTicketFlowInterrupted, TICKET_FLOW_STEPS } from '../tickets/ticketFlow';
import { LineScreenHeader } from './LinePortalChrome';
import { thaiDateTime, thaiDayTime } from './lineTime';
import type { LineTicketDetail as LineTicketDetailData, LineTicketWorklog } from './types';

const CARD = 'rounded-card border border-hairline bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-900';
const CONVERSATION_LOCKED_STATUSES = ['ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident'];

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {children}
    </span>
  );
}

/** ชื่อผู้บันทึกที่ผู้แจ้งควรเห็น — ของตัวเองขึ้น "ท่าน" ที่เหลือคือทีม IT */
function worklogAuthor(log: LineTicketWorklog): string {
  if (log.actor_line_user_id) return 'ท่าน';
  return log.actor?.full_name ? `${log.actor.full_name} · ทีม IT` : log.actor_label ?? 'ทีม IT';
}

export function LineTicketDetail({ detail, onBack, onSign, onSendMessage }: {
  detail: LineTicketDetailData;
  onBack: () => void;
  onSign: (file: File, ratings: TicketRatingDetails, feedback?: string) => Promise<void>;
  onSendMessage: (message: string) => Promise<void>;
}) {
  const { ticket } = detail;
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const timeline = detail.worklogs.filter((log) => log.entry_type !== 'comment');
  const conversation = detail.worklogs.filter((log) => log.entry_type === 'comment');
  const sla = ticketSlaBadge(ticket.due_at, ticket.status);
  const flowIndex = getTicketFlowIndex(ticket.status, timeline);
  const interrupted = isTicketFlowInterrupted(ticket.status);
  const conversationLocked = CONVERSATION_LOCKED_STATUSES.includes(ticket.status);
  const ratingBreakdown = ticket.rating_criteria_snapshot?.length
    ? ticket.rating_criteria_snapshot
    : TICKET_RATING_CRITERIA.flatMap((criterion) => {
      const score = ticket.rating_details?.[criterion.key];
      return score === undefined ? [] : [{ key: criterion.key, label: criterion.label, score }];
    });

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return;
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
    <div className="flex flex-col pb-4">
      <LineScreenHeader
        onBack={onBack}
        eyebrow={`${ticket.ticket_no} · แจ้งเมื่อ ${thaiDateTime(ticket.created_at)}`}
        title={<StatusBadge display={{ label: ticketStatusLabel[ticket.status], tone: ticketStatusTone[ticket.status] }} />}
      />

      <div className="flex flex-col gap-3 px-4 pt-4">
        <div>
          <h1 className="text-lg font-bold leading-6 text-slate-900 dark:text-slate-100">{ticket.title}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ticket.category?.name && <Chip>{ticket.category.name}</Chip>}
            <Chip>ระดับ {ticket.priority}</Chip>
            {ticket.asset_name_snapshot && <Chip>{ticket.asset_name_snapshot}</Chip>}
            {ticket.location && <Chip>{ticket.location}</Chip>}
            {ticket.department_name_snapshot && <Chip>{ticket.department_name_snapshot}</Chip>}
          </div>
          <p className="mt-3 whitespace-pre-wrap text-[13px] leading-6 text-slate-600 dark:text-slate-300">{ticket.description}</p>
        </div>

        {sla && (
          <div className="flex items-center gap-2 rounded-card border border-hairline bg-white px-3 py-2.5 shadow-card dark:border-slate-700 dark:bg-slate-900">
            <SlaBadge display={sla} />
            <span className="text-[11px] text-slate-500 dark:text-slate-400">ครบกำหนด {thaiDayTime(ticket.due_at!)}</span>
          </div>
        )}

        <section className={CARD} aria-labelledby="line-ticket-progress">
          <div className="flex items-center justify-between gap-3">
            <h2 id="line-ticket-progress" className="text-sm font-bold text-slate-900 dark:text-slate-100">ความคืบหน้า</h2>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              ขั้นที่ {flowIndex + 1} จาก {TICKET_FLOW_STEPS.length} · {TICKET_FLOW_STEPS[flowIndex].label}
            </span>
          </div>

          <div className="mt-3 flex gap-1" aria-hidden="true">
            {TICKET_FLOW_STEPS.map((step, index) => (
              <span
                key={step.label}
                className={cn(
                  'h-1.5 flex-1 rounded-full',
                  index < flowIndex ? 'bg-primary-600' : index === flowIndex ? 'bg-primary-400' : 'bg-slate-200 dark:bg-slate-700',
                )}
              />
            ))}
          </div>

          {interrupted && (
            <p className="mt-3 flex items-start gap-1.5 rounded-card bg-danger-50 px-3 py-2 text-[11px] leading-5 text-danger-700 dark:bg-danger-600/15 dark:text-danger-100" role="note">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ขั้นตอนปกติหยุดลงเพราะสถานะปัจจุบันคือ {ticketStatusLabel[ticket.status]}
            </p>
          )}

          {timeline.length === 0 ? (
            <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">ยังไม่มีบันทึกความคืบหน้า</p>
          ) : (
            <ol className="mt-4 flex flex-col">
              {[...timeline].reverse().map((log, index) => (
                <li key={log.id ?? `${log.created_at}-${index}`} className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
                  <span className="relative flex justify-center">
                    <span className={cn('mt-1 h-2.5 w-2.5 rounded-full ring-4', index === 0 ? 'bg-primary-600 ring-primary-100 dark:ring-primary-900/50' : 'bg-slate-300 ring-white dark:bg-slate-600 dark:ring-slate-900')} aria-hidden="true" />
                    {index < timeline.length - 1 && <span className="absolute left-1/2 top-4 h-full w-px -translate-x-1/2 bg-slate-200 dark:bg-slate-700" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{log.action}</span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">{thaiDayTime(log.created_at)}</span>
                    </span>
                    {log.detail && <span className="mt-0.5 block text-[12px] leading-5 text-slate-600 dark:text-slate-300">{log.detail}</span>}
                    {log.status_to && (
                      <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">
                        สถานะ{log.status_from ? ` ${ticketStatusLabel[log.status_from]} →` : ''} {ticketStatusLabel[log.status_to]}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {ticket.assignee_name_snapshot && (
          <section className="flex items-center gap-3 rounded-card border border-hairline bg-white p-3.5 shadow-card dark:border-slate-700 dark:bg-slate-900">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200">
              <Headset className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold text-slate-900 dark:text-slate-100">{ticket.assignee_name_snapshot} · ทีม IT</span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">ผู้รับผิดชอบ Ticket นี้</span>
            </span>
          </section>
        )}

        {ticket.resolution && (
          <section className={CARD}>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">ผลการดำเนินการ</h2>
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-6 text-slate-600 dark:text-slate-300">{ticket.resolution}</p>
          </section>
        )}

        <RequesterInfoCard
          info={{
            name: ticket.requester_name_snapshot,
            position: ticket.requester_position_snapshot,
            department: ticket.department_name_snapshot,
            phone: ticket.requester_phone,
            incidentAt: ticket.incident_at,
            erpModule: ticket.erp_module,
            location: ticket.location,
            assetName: ticket.asset_name_snapshot,
          }}
        />

        <RequesterSignoffCard
          status={ticket.status}
          signatureUrl={ticket.requester_signature_url}
          signedAt={ticket.requester_signature_uploaded_at}
          requesterName={ticket.requester_name_snapshot}
          criteria={detail.ratingCriteria}
          rating={ticket.rating}
          onSign={onSign}
        />

        <section className={CARD} aria-labelledby="line-ticket-conversation">
          <div className="flex items-center justify-between gap-3">
            <h2 id="line-ticket-conversation" className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
              <MessageCircle className="h-4 w-4 text-primary-700 dark:text-primary-300" aria-hidden="true" /> ข้อความถึงทีม IT
            </h2>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">{conversation.length} ข้อความ</span>
          </div>

          {conversation.length === 0 ? (
            <p className="mt-3 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
              ยังไม่มีข้อความ — ส่งข้อมูลเพิ่มเติมหรือสอบถามความคืบหน้าได้ที่นี่ ทีม IT จะเห็นข้อความบนใบงานเดียวกัน
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2.5">
              {conversation.map((log, index) => {
                const mine = Boolean(log.actor_line_user_id);
                return (
                  <li key={log.id ?? `${log.created_at}-${index}`} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">{worklogAuthor(log)} · {thaiDayTime(log.created_at)}</span>
                    <span
                      className={cn(
                        'mt-1 max-w-[85%] whitespace-pre-wrap rounded-card px-3 py-2 text-[12px] leading-5',
                        mine
                          ? 'bg-primary-700 text-white'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
                      )}
                    >
                      {log.detail ?? log.action}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {conversationLocked ? (
            <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">Ticket นี้ปิดแล้ว หากยังพบปัญหากรุณาแจ้งเรื่องใหม่</p>
          ) : (
            <form onSubmit={(event) => void send(event)} className="mt-3 flex items-end gap-2">
              <label htmlFor="line-ticket-message" className="sr-only">พิมพ์ข้อความถึงทีม IT</label>
              <textarea
                id="line-ticket-message"
                className="public-field flex-1 resize-none px-3 py-2 text-[13px] focus:outline-none"
                rows={1}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={1000}
                placeholder="พิมพ์ข้อความ..."
              />
              <button
                type="submit"
                disabled={sending || message.trim().length === 0}
                className="public-primary-button flex h-11 w-11 shrink-0 items-center justify-center text-white disabled:opacity-60"
                aria-label="ส่งข้อความ"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              </button>
            </form>
          )}
          {sendError && <p className="mt-2 text-[11px] text-danger-700" role="alert">{sendError}</p>}
        </section>

        {detail.attachments.length > 0 && (
          <section className={CARD} aria-labelledby="line-ticket-attachments">
            <h2 id="line-ticket-attachments" className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
              <Paperclip className="h-4 w-4 text-primary-700 dark:text-primary-300" aria-hidden="true" /> ไฟล์แนบ
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {detail.attachments.map((attachment) => (
                <li key={attachment.id}>
                  {attachment.signed_url ? (
                    <a
                      href={attachment.signed_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-card border border-hairline px-3 py-2 text-[12px] text-slate-700 transition hover:border-primary-300 dark:border-slate-700 dark:text-slate-200"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      <span className="truncate">{attachment.original_filename}</span>
                    </a>
                  ) : (
                    <span className="flex items-center gap-2 rounded-card border border-hairline px-3 py-2 text-[12px] text-slate-400 dark:border-slate-700">
                      <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{attachment.original_filename} (ลิงก์หมดอายุ)</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {ticket.rating != null && (
          <section className={CARD}>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
              <Star className="h-4 w-4 text-warning-600" aria-hidden="true" /> ผลประเมินการบริการ {ticket.rating}/5
            </h2>
            <ul className="mt-2 flex flex-col gap-1">
              {ratingBreakdown.map((criterion) => (
                <li key={criterion.key} className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>{criterion.label}</span><b className="text-slate-700 dark:text-slate-200">{criterion.score}/5</b>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
