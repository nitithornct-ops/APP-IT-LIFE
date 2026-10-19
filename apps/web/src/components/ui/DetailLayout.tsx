import type { ReactNode } from 'react';

export function DetailLayout({
  children,
  timeline,
  aside,
  asideFirstOnMobile = false,
}: {
  children: ReactNode;
  timeline?: ReactNode;
  aside: ReactNode;
  asideFirstOnMobile?: boolean;
}) {
  const main = <div className={asideFirstOnMobile ? 'min-w-0 space-y-3 xl:col-start-1 xl:row-start-1' : 'min-w-0 space-y-3'}>{children}{timeline}</div>;
  const sidebar = <aside className={`min-w-0 space-y-3 xl:sticky xl:top-[calc(var(--app-header-height,64px)+12px)] xl:self-start${asideFirstOnMobile ? ' xl:col-start-2 xl:row-start-1' : ''}`} aria-label="แผงควบคุมและข้อมูลประกอบ">{aside}</aside>;
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
      {asideFirstOnMobile ? <>{sidebar}{main}</> : <>{main}{sidebar}</>}
    </div>
  );
}
