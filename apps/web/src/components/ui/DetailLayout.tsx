import type { ReactNode } from 'react';

export function DetailLayout({
  children,
  timeline,
  aside,
}: {
  children: ReactNode;
  timeline?: ReactNode;
  aside: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3">
        {children}
        {timeline}
      </div>
      <aside className="min-w-0 space-y-3 xl:sticky xl:top-[58px] xl:self-start" aria-label="แผงควบคุมและข้อมูลประกอบ">
        {aside}
      </aside>
    </div>
  );
}
