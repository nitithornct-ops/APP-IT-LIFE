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
  const main = <div className={asideFirstOnMobile ? 'min-w-0 space-y-6 xl:col-start-1 xl:row-start-1' : 'min-w-0 space-y-6'}>{children}{timeline}</div>;
  const sidebar = <aside className={`min-w-0 space-y-6 xl:self-start${asideFirstOnMobile ? ' xl:col-start-2 xl:row-start-1' : ''}`} aria-label="แผงควบคุมและข้อมูลประกอบ">{aside}</aside>;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,24rem)]">
      {asideFirstOnMobile ? <>{sidebar}{main}</> : <>{main}{sidebar}</>}
    </div>
  );
}
