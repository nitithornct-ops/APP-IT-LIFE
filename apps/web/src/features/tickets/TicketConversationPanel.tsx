import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send, Shield } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ApiError, apiFetch } from '../../services/apiClient';
import type { TicketDetail } from '../../types/tickets';
import { cn } from '../../utils/cn';
import { formatThaiDate } from '../../utils/date';
import { CONVERSATION_LOCKED_STATUSES, conversationAuthor, isConversationEntry } from './ticketConversation';

function ConversationComposer({
  ticketId,
  canComment,
  canInternalNote,
  publicLocked,
}: {
  ticketId: string;
  canComment: boolean;
  canInternalNote: boolean;
  publicLocked: boolean;
}) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [internal, setInternal] = useState(!canComment && canInternalNote);
  const [serverError, setServerError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tickets/${ticketId}/conversation`, {
      method: 'POST',
      body: JSON.stringify({ message, visibility: internal ? 'internal' : 'public' }),
    }),
    onSuccess: () => {
      setMessage('');
      setServerError(null);
      void queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] });
    },
    onError: (error) => setServerError(error instanceof ApiError ? error.message : 'ส่งข้อความไม่สำเร็จ'),
  });

  const selectedLocked = !internal && publicLocked;

  return (
    <div className="mt-3 border-t border-hairline-row pt-3 dark:border-white/[.07]">
      {canInternalNote && (
        <label className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={internal}
            onChange={(event) => setInternal(event.target.checked)}
            disabled={!canComment && canInternalNote}
          />
          <Shield className="h-3.5 w-3.5" aria-hidden="true" />บันทึกภายใน (ผู้แจ้งจะไม่เห็น)
        </label>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
          {internal ? 'บันทึกสำหรับเจ้าหน้าที่' : 'ข้อความถึงผู้เกี่ยวข้อง'}
          <textarea
            aria-label={internal ? 'บันทึกภายใน' : 'ข้อความสนทนา'}
            rows={2}
            value={message}
            disabled={selectedLocked}
            onChange={(event) => setMessage(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
          />
        </label>
        <Button size="sm" disabled={!message.trim() || selectedLocked} isLoading={mutation.isPending} onClick={() => mutation.mutate()}>
          <Send className="h-4 w-4" aria-hidden="true" />ส่ง
        </Button>
      </div>
      {selectedLocked && <p className="mt-2 text-xs text-amber-600">Ticket ที่ปิดหรือยกเลิกแล้วเพิ่มได้เฉพาะบันทึกภายใน</p>}
      {serverError && <p className="mt-2 text-xs text-red-600">{serverError}</p>}
    </div>
  );
}

/**
 * ห้องสนทนาระหว่างผู้แจ้งกับช่างผู้ดำเนินการ — แยกออกจากไทม์ไลน์ประวัติการดำเนินงาน เพราะ
 * บทสนทนาต้องอ่านต่อเนื่องเป็นบทพูดคุย ส่วนไทม์ไลน์อ่านเป็นลำดับเหตุการณ์ ทั้งสองอย่างยังเก็บใน
 * ticket_worklogs ตารางเดียวกัน แค่แยกกันแสดงตาม entry_type
 */
export function TicketConversationPanel({
  ticket,
  viewerId,
  canComment,
  canInternalNote,
}: {
  ticket: TicketDetail;
  viewerId?: string;
  canComment: boolean;
  canInternalNote: boolean;
}) {
  const messages = ticket.worklogs
    .filter(isConversationEntry)
    .slice()
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  const threadRef = useRef<HTMLOListElement>(null);
  const lastMessageId = messages.at(-1)?.id;

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [lastMessageId]);

  return (
    <Card>
      <CardHeader>
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><MessageSquare className="h-4 w-4" aria-hidden="true" />การสนทนากับผู้แจ้ง</span>
          <span className="text-xs font-normal text-slate-400">{messages.length} ข้อความ</span>
        </span>
      </CardHeader>
      <CardBody data-testid="ticket-conversation">
        {messages.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            ยังไม่มีข้อความ — พิมพ์ด้านล่างเพื่อสอบถามหรือแจ้งความคืบหน้ากับผู้แจ้ง
          </p>
        ) : (
          <ol ref={threadRef} className="flex max-h-[26rem] flex-col gap-3 overflow-y-auto pr-1">
            {messages.map((log) => {
              const mine = Boolean(viewerId) && log.actor_id === viewerId;
              const internalNote = log.entry_type === 'internal_note';
              return (
                <li key={log.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    {conversationAuthor(log, ticket, viewerId)} · {formatThaiDate(log.created_at, 'd MMM yyyy HH:mm')}
                    {internalNote && <span className="ml-1 font-semibold text-amber-600">· ภายใน</span>}
                  </span>
                  <span
                    className={cn(
                      'mt-1 max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-6',
                      internalNote
                        ? 'border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-100'
                        : mine
                          ? 'bg-primary-700 text-white'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
                    )}
                  >
                    {log.detail ?? log.action}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {(canComment || canInternalNote) && (
          <ConversationComposer
            ticketId={ticket.id}
            canComment={canComment}
            canInternalNote={canInternalNote}
            publicLocked={CONVERSATION_LOCKED_STATUSES.includes(ticket.status)}
          />
        )}
      </CardBody>
    </Card>
  );
}
