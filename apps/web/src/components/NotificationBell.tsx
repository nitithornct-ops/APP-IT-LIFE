import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsList,
  useUnreadNotificationCount,
} from '../hooks/useNotifications';
import { formatThaiDate } from '../utils/date';

/**
 * กระดิ่งแจ้งเตือนแบบง่ายสำหรับ Phase 4 (พิสูจน์ว่า Notification Service ทำงานจริงต้นทางถึงปลายทาง)
 * ดีไซน์เต็มรูปแบบ (Toast/Sound/Real-time) จะอยู่ใน Phase 5 (Frontend Core)
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data: unread } = useUnreadNotificationCount();
  const { data: list, isLoading } = useNotificationsList(open);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = unread?.count ?? 0;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative flex h-8 w-8 items-center justify-center rounded-[7px] text-slate-600 hover:bg-primary-50 hover:text-primary-800 dark:text-slate-300 dark:hover:bg-white/[.07]"
        aria-label="การแจ้งเตือน"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-80 overflow-hidden rounded-card border border-slate-200 bg-white shadow-elevated dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-700">
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">การแจ้งเตือน</span>
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending || unreadCount === 0}
              className="min-h-10 px-2 text-xs font-semibold text-primary-700 hover:underline disabled:text-slate-400 disabled:no-underline dark:text-primary-300"
            >
              อ่านทั้งหมด
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {isLoading && <p className="p-3 text-sm text-slate-500">กำลังโหลด...</p>}
            {!isLoading && list?.items.length === 0 && (
              <p className="p-3 text-sm text-slate-500">ไม่มีการแจ้งเตือน</p>
            )}
            {list?.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (!item.is_read) markRead.mutate(item.id);
                  if (item.link) {
                    setOpen(false);
                    navigate(item.link);
                  }
                }}
                className={`block min-h-10 w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700 ${
                  item.is_read ? 'text-slate-500' : 'font-medium text-slate-800 dark:text-slate-100'
                }`}
              >
                <p>{item.title}</p>
                {item.body && <p className="mt-0.5 text-xs font-normal text-slate-500">{item.body}</p>}
                <p className="mt-0.5 text-xs font-normal text-slate-400">
                  {formatThaiDate(item.created_at, 'd MMMM yyyy HH:mm')}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
