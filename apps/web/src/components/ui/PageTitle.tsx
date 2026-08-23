import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface PageTitleProps {
  /** หมวดในเมนูซ้าย เขียนเป็น "กลุ่ม / ชื่อเมนู" ให้ผู้ใช้รู้ว่ากำลังอยู่ตรงไหนของระบบ */
  eyebrow: ReactNode;
  title: ReactNode;
  description: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  variant?: 'default' | 'hero';
}

/**
 * บล็อกหัวข้อหน้า — นิยามเดียวของ "หัวข้อหน้าตาเป็นยังไง" ทั้งระบบ
 *
 * ก่อนหน้านี้ 54 หน้าเขียน <h1> เองคนละขนาด (text-xl 36 หน้า, text-2xl 15 หน้า) คนละน้ำหนัก
 * (bold 29 / extrabold 18 / semibold 8) และไม่มีหน้าไหนมี eyebrow เลย เวลาสลับหน้าไปมาจึงรู้สึกว่า
 * เป็นคนละระบบ ทั้งที่กรอบการ์ดถูก CSS ครอบให้เหมือนกันแล้ว
 *
 * ขนาดที่ใช้ตรง 01-design-tokens.md ข้อ 1: หัวข้อส่วน 18–22px / 800, eyebrow mono 10px / 600
 * letter-spacing .06–.14em, ข้อความรอง 13.5px
 *
 * แยกจาก PageHeader เพราะหลายหน้ามีแถบเครื่องมือของตัวเองอยู่แล้ว (ปุ่ม, tab, ตัวกรอง) การบังคับให้
 * ทุกหน้าเข้าโครง PageHeader ทั้งก้อนจะต้องรื้อ layout ของปุ่มพวกนั้นด้วย ซึ่งเสี่ยงกว่าประโยชน์ที่ได้
 * PageHeader จึงใช้ PageTitle ตัวนี้ข้างในอีกที ขนาดตัวอักษรจึงมีที่มาที่เดียวจริง ๆ
 */
export function PageTitle({ eyebrow, title, description, meta, leading, variant = 'default' }: PageTitleProps) {
  return (
    <div className="life-page-title flex min-w-0 items-start gap-3">
      {leading && (
        <span
          className={cn(
            'mt-0.5 grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] border border-primary-200 bg-primary-100 text-primary-700 dark:border-primary-700 dark:bg-primary-900/40 dark:text-primary-200',
            variant === 'hero' && 'border-white/20 bg-white/10 text-white',
          )}
          aria-hidden="true"
        >
          {leading}
        </span>
      )}
      <div className="min-w-0">
        <p className="life-page-eyebrow font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-700 dark:text-primary-300">{eyebrow}</p>
        <h1 className="mt-0.5 text-[22px] font-extrabold text-ink-heading dark:text-[#e8eef9]">{title}</h1>
        <p className="mt-1 max-w-3xl text-[13.5px] text-slate-500 dark:text-white/45">{description}</p>
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
    </div>
  );
}
