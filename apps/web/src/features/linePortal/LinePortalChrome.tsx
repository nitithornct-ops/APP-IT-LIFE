import { ArrowLeft, Bell, BookOpen, ClipboardList, Home, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import type { LinePortalTab } from './types';

const TABS: Array<{ key: LinePortalTab; label: string; icon: typeof Home }> = [
  { key: 'home', label: 'หน้าแรก', icon: Home },
  { key: 'tickets', label: 'งานของฉัน', icon: ClipboardList },
  { key: 'knowledge', label: 'วิธีแก้', icon: BookOpen },
  { key: 'notifications', label: 'แจ้งเตือน', icon: Bell },
  { key: 'profile', label: 'โปรไฟล์', icon: UserRound },
];

/**
 * แถบเมนูล่างของพอร์ทัล — ตรึงไว้ที่ก้นจอเหมือนแอปมือถือ และกว้างเท่าเนื้อหา (max-w-md)
 * เพื่อไม่ให้ยืดเต็มจอเมื่อเปิดบนเดสก์ท็อป
 */
export function LinePortalNav({ tab, unreadCount, onChange }: {
  tab: LinePortalTab;
  unreadCount: number;
  onChange: (tab: LinePortalTab) => void;
}) {
  return (
    <nav
      className="life-bottom-nav fixed inset-x-0 bottom-0 z-30 border-t"
      aria-label="เมนูหลักของพอร์ทัล"
    >
      <ul className="mx-auto flex w-full max-w-md items-stretch">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <li key={key} className="flex-1">
              <button
                type="button"
                onClick={() => onChange(key)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex w-full flex-col items-center gap-1 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2.5 text-[11px] font-semibold transition',
                  active ? 'text-primary-700 dark:text-primary-200' : 'text-slate-500 dark:text-slate-400',
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {key === 'notifications' && unreadCount > 0 && (
                    <span
                      className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[9px] font-bold text-white"
                      aria-hidden="true"
                    >
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** หัวจอย่อยที่เปิดทับ tab (แจ้งซ่อมใหม่ / รายละเอียด Ticket) */
export function LineScreenHeader({ onBack, eyebrow, title, action }: {
  onBack: () => void;
  eyebrow?: ReactNode;
  title: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onBack}
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-hairline text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="ย้อนกลับ"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          {eyebrow && <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{eyebrow}</p>}
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</div>
        </div>
        {action}
      </div>
    </header>
  );
}

export function LineSectionHeading({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h2>
      {action}
    </div>
  );
}

export function LineEmptyState({ icon: Icon, title, description }: {
  icon: typeof Home;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-hairline bg-white px-4 py-10 text-center dark:border-slate-700 dark:bg-slate-900">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      {description && <p className="max-w-[16rem] text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>}
    </div>
  );
}
