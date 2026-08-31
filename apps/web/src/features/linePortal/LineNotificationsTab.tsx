import { BellOff } from 'lucide-react';
import { cn } from '../../utils/cn';
import { LineEmptyState } from './LinePortalChrome';
import { relativeThaiTime } from './lineTime';
import { notificationText } from './linePortalText';
import type { LineNotification } from './types';

export function LineNotificationsTab({ notifications, lastReadAt, onOpenTicket }: {
  notifications: LineNotification[];
  lastReadAt: string | null;
  onOpenTicket: (id: string) => void;
}) {
  const readCutoff = lastReadAt ? new Date(lastReadAt).getTime() : 0;

  return (
    <div className="flex flex-col pb-4">
      <header className="sticky top-0 z-20 border-b border-hairline bg-white/95 px-4 pb-3 pt-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <h1 className="text-sm font-bold text-slate-900 dark:text-slate-100">การแจ้งเตือน</h1>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">แตะเพื่อเปิด Ticket ต้นทาง</p>
      </header>

      <div className="px-4 pt-3">
        {notifications.length === 0 ? (
          <LineEmptyState
            icon={BellOff}
            title="ยังไม่มีการแจ้งเตือน"
            description="เมื่อทีม IT อัปเดตความคืบหน้าของ Ticket ท่านจะเห็นที่นี่"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {notifications.map((notification) => {
              const unread = new Date(notification.created_at).getTime() > readCutoff;
              return (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => onOpenTicket(notification.ticket_id)}
                    className={cn(
                      'w-full rounded-card border p-3.5 text-left transition',
                      unread
                        ? 'border-primary-200 bg-primary-50 hover:border-primary-300 dark:border-primary-800 dark:bg-primary-900/30'
                        : 'border-hairline bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', unread ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-600')}
                        aria-hidden="true"
                      />
                      <span className="font-mono text-[11px] font-bold text-primary-700 dark:text-primary-300">{notification.ticket_no}</span>
                      <span className="ml-auto text-[11px] text-slate-400 dark:text-slate-500">{relativeThaiTime(notification.created_at)}</span>
                      {unread && <span className="sr-only">ยังไม่ได้อ่าน</span>}
                    </span>
                    <span className="mt-1.5 block text-[13px] leading-5 text-slate-700 dark:text-slate-200">
                      {notificationText(notification)}
                    </span>
                    <span className="mt-1 line-clamp-1 block text-[11px] text-slate-400 dark:text-slate-500">{notification.ticket_title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
