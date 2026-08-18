import { Ban, Eye, Pencil, Trash2, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RequirePermission } from '../RequirePermission';
import { ConfirmModal } from '../ui/Modal';
import { cn } from '../../utils/cn';

/**
 * ชุดปุ่มท้ายแถวที่ทุกตารางใช้ร่วมกัน
 *
 * ก่อนหน้านี้แต่ละหน้าประกอบปุ่มเอง ผลคือ 28 ตารางมีวิธีเปิดดูข้อมูลไม่เหมือนกันสักหน้า — บางหน้าเป็นปุ่ม
 * "รายละเอียด" บางหน้าเป็นข้อความสีฟ้าในคอลัมน์แรก บางหน้าเป็นสวิตช์ และบางหน้าไม่มีอะไรเลย ผู้ใช้จึง
 * ต้องเรียนรู้ใหม่ทุกหน้า (พบตอนตรวจหลัง go-live 2026-08-18)
 *
 * "ลบ" กับ "ยกเลิก" แยกกันโดยตั้งใจ: เอกสารงาน (Ticket, Incident, Change) ห้ามลบเพราะประวัติ SLA และ
 * audit log ผูกอยู่กับมัน จึงใช้ยกเลิกแล้วเก็บไว้ ส่วน "ลบ" สงวนไว้ให้ข้อมูลตั้งค่าที่ลบทิ้งได้จริง
 * ทั้งสองแบบบังคับผ่านกล่องยืนยันเสมอ ไม่มีทางกดพลาดแล้วข้อมูลหายทันที
 */
export interface RowAction {
  kind: 'view' | 'edit' | 'cancel' | 'delete' | 'custom' | 'node';
  /** kind: 'node' — ปุ่มที่มีหน้าต่างของตัวเอง (เช่น ต้องกรอกเหตุผล) วางไว้ในแถวเดียวกันเพื่อให้ตำแหน่งตรงกับหน้าอื่น */
  node?: ReactNode;
  /** ทับข้อความเริ่มต้นของแต่ละชนิด */
  label?: string;
  /** ใช้กับ kind: 'custom' เท่านั้น */
  icon?: LucideIcon;
  /** view: ลิงก์ไปหน้ารายละเอียด (ใช้แทน onClick) */
  to?: string;
  onClick?: () => void;
  /** cancel/delete: เรียกเมื่อผู้ใช้กดยืนยันในกล่องแล้วเท่านั้น */
  onConfirm?: () => void;
  confirmTitle?: string;
  confirmDescription?: ReactNode;
  isPending?: boolean;
  /** คีย์สิทธิ์ที่ต้องมีจึงจะเห็นปุ่มนี้ — ไม่ใส่ = ทุกคนที่เข้าถึงหน้านี้ได้เห็น */
  permission?: string;
  disabled?: boolean;
  /** ซ่อนตามสถานะของแถว เช่น งานที่ปิดไปแล้วยกเลิกไม่ได้อีก */
  hidden?: boolean;
}

interface RowActionsProps {
  /** ชื่อ/เลขที่ของรายการ ใช้ในข้อความยืนยันเพื่อให้เห็นชัดว่ากำลังทำกับแถวไหน */
  recordLabel: string;
  actions: RowAction[];
  className?: string;
}

const PRESETS: Record<RowAction['kind'], { label: string; icon: LucideIcon; tone: string; needsConfirm: boolean }> = {
  view: { label: 'ดู', icon: Eye, tone: 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700', needsConfirm: false },
  edit: { label: 'แก้ไข', icon: Pencil, tone: 'text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-900/40', needsConfirm: false },
  cancel: { label: 'ยกเลิก', icon: Ban, tone: 'text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-900/40', needsConfirm: true },
  delete: { label: 'ลบ', icon: Trash2, tone: 'text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-900/40', needsConfirm: true },
  custom: { label: '', icon: Eye, tone: 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700', needsConfirm: false },
  node: { label: '', icon: Eye, tone: '', needsConfirm: false },
};

const BUTTON_CLASS = 'inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40';

export function RowActions({ recordLabel, actions, className }: RowActionsProps) {
  const [pending, setPending] = useState<RowAction | null>(null);
  const visible = actions.filter((action) => !action.hidden);
  if (visible.length === 0) return <span className="text-xs text-slate-400">—</span>;

  const preset = pending ? PRESETS[pending.kind] : null;

  return (
    <>
      <div className={cn('flex flex-wrap items-center justify-end gap-1', className)}>
        {visible.map((action, index) => {
          if (action.kind === 'node') return <span key={index} className="contents">{action.node}</span>;
          const base = PRESETS[action.kind];
          const Icon = action.icon ?? base.icon;
          const label = action.label ?? base.label;
          const content = <><Icon className="h-3.5 w-3.5" aria-hidden />{label}</>;

          const button = action.to && !action.disabled
            ? <Link key={index} to={action.to} aria-label={`${label} ${recordLabel}`} className={cn(BUTTON_CLASS, base.tone)}>{content}</Link>
            : (
              <button
                key={index}
                type="button"
                disabled={action.disabled}
                aria-label={`${label} ${recordLabel}`}
                onClick={() => (base.needsConfirm ? setPending(action) : action.onClick?.())}
                className={cn(BUTTON_CLASS, base.tone)}
              >
                {content}
              </button>
            );

          return action.permission
            ? <RequirePermission key={index} permission={action.permission}>{button}</RequirePermission>
            : button;
        })}
      </div>

      {pending && preset && (
        <ConfirmModal
          title={pending.confirmTitle ?? `${pending.label ?? preset.label}${recordLabel ? ` "${recordLabel}"` : ''}`}
          description={pending.confirmDescription ?? (pending.kind === 'delete'
            ? 'ข้อมูลนี้จะถูกลบออกจากระบบและกู้คืนไม่ได้'
            : 'รายการจะถูกยกเลิกแต่ยังคงอยู่ในระบบเพื่อการตรวจสอบย้อนหลัง')}
          tone={pending.kind === 'delete' ? 'danger' : 'primary'}
          confirmLabel={pending.kind === 'delete' ? 'ลบข้อมูล' : 'ยืนยันยกเลิก'}
          cancelLabel="ไม่ใช่ตอนนี้"
          isPending={pending.isPending}
          testId="row-actions-confirm"
          onConfirm={() => {
            pending.onConfirm?.();
            setPending(null);
          }}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
