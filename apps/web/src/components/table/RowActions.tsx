import { Archive, Ban, Eye, Pencil, Trash2, type LucideIcon } from 'lucide-react';
import { QueryClientContext } from '@tanstack/react-query';
import { useContext, useState, type ReactNode } from 'react';
import { Link, useInRouterContext, useLocation, type LinkProps } from 'react-router-dom';
import { RequirePermission } from '../RequirePermission';
import { ConfirmModal } from '../ui/Modal';
import { apiFetch } from '../../services/apiClient';
import { cn } from '../../utils/cn';
import './data-table.css';

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
  kind: 'view' | 'edit' | 'cancel' | 'archive' | 'delete' | 'custom' | 'node';
  /** kind: 'node' — ปุ่มที่มีหน้าต่างของตัวเอง (เช่น ต้องกรอกเหตุผล) วางไว้ในแถวเดียวกันเพื่อให้ตำแหน่งตรงกับหน้าอื่น */
  node?: ReactNode;
  /** ทับข้อความเริ่มต้นของแต่ละชนิด */
  label?: string;
  /** ใช้กับ kind: 'custom' เท่านั้น */
  icon?: LucideIcon;
  /** view: ลิงก์ไปหน้ารายละเอียด (ใช้แทน onClick) */
  to?: string;
  /** Preserve the originating list context when opening a record. */
  state?: LinkProps['state'];
  onClick?: () => void;
  /** cancel/delete: เรียกเมื่อผู้ใช้กดยืนยันในกล่องแล้วเท่านั้น — ได้เหตุผลมาด้วยเมื่อตั้ง reasonLabel */
  onConfirm?: (reason: string) => void;
  /** delete: endpoint กลางที่ RowActions เรียกหลังยืนยัน แล้ว refresh query ที่กำลังแสดงอยู่ */
  deleteEndpoint?: string;
  /** archive: endpoint เดียวกัน แต่ป้ายและคำยืนยันบอกชัดว่าเก็บข้อมูลไว้ตรวจสอบย้อนหลัง */
  archiveEndpoint?: string;
  /** บังคับให้พิมพ์เหตุผลก่อนยืนยัน สำหรับงานที่ต้องตอบให้ได้ภายหลังว่าทำไมถึงยกเลิก */
  reasonLabel?: string;
  reasonPlaceholder?: string;
  confirmTitle?: string;
  confirmDescription?: ReactNode;
  confirmLabel?: string;
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
  /** ซ่อนข้อความบนหน้าจอและคงไว้เฉพาะไอคอน โดย title/aria-label ยังอธิบายปุ่มครบ */
  iconOnly?: boolean;
}

/**
 * ลำดับมาตรฐานของ action ในทุกโมดูล
 *
 * custom/node อยู่กลางชุดเพราะเป็นงานเสริมของโมดูล ส่วน action ที่มีผลกับสถานะ
 * หรือข้อมูลวางท้ายสุดเสมอ เพื่อลดโอกาสกดพลาดและทำให้ผู้ใช้หา "ลบ" ได้ตำแหน่งเดิมทุกหน้า
 */
const ACTION_ORDER: Record<RowAction['kind'], number> = {
  view: 0,
  edit: 1,
  custom: 2,
  node: 2,
  cancel: 3,
  archive: 4,
  delete: 5,
};

const PRESETS: Record<RowAction['kind'], { label: string; icon: LucideIcon; tone: string; needsConfirm: boolean }> = {
  view: { label: 'ดู', icon: Eye, tone: 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700', needsConfirm: false },
  edit: { label: 'แก้ไข', icon: Pencil, tone: 'text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-900/40', needsConfirm: false },
  cancel: { label: 'ยกเลิก', icon: Ban, tone: 'text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-900/40', needsConfirm: true },
  archive: { label: 'เก็บถาวร', icon: Archive, tone: 'text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-900/40', needsConfirm: true },
  delete: { label: 'ลบ', icon: Trash2, tone: 'text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-900/40', needsConfirm: true },
  custom: { label: '', icon: Eye, tone: 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700', needsConfirm: false },
  node: { label: '', icon: Eye, tone: '', needsConfirm: false },
};

const BUTTON_CLASS = 'inline-flex min-h-11 min-w-11 max-w-full items-center justify-center gap-1.5 rounded-lg border border-transparent px-2.5 py-2 text-xs font-semibold leading-relaxed transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-not-allowed disabled:opacity-40';

const DETAIL_LIST_PATHS = new Set(['/tickets', '/assets', '/incidents', '/problems', '/changes', '/cmdb', '/service-requests', '/access-requests']);

function ContextualActionLink(props: LinkProps) {
  const location = useLocation();
  const listState = DETAIL_LIST_PATHS.has(location.pathname)
    ? { listReturnTo: `${location.pathname}${location.search}` }
    : undefined;
  return <Link {...props} state={props.state === undefined ? listState : props.state} />;
}

export function RowActions({ recordLabel, actions, className, iconOnly = false }: RowActionsProps) {
  const [pending, setPending] = useState<RowAction | null>(null);
  const [reason, setReason] = useState('');
  const [endpointDeletePending, setEndpointDeletePending] = useState(false);
  const queryClient = useContext(QueryClientContext);
  const inRouter = useInRouterContext();

  const mutateFromEndpoint = async (endpoint: string, mutationReason: string) => {
    setEndpointDeletePending(true);
    try {
      await apiFetch(endpoint, { method: 'DELETE', body: JSON.stringify({ reason: mutationReason }) });
      setPending(null);
      setReason('');
      await queryClient?.invalidateQueries({ type: 'active' });
    } catch {
      // apiFetch แสดงข้อความผิดพลาดให้ผู้ใช้แล้ว และคง modal ไว้ให้ลองใหม่ได้
    } finally {
      setEndpointDeletePending(false);
    }
  };
  // Array.sort ใน JavaScript เป็น stable sort: custom actions ที่มี rank เดียวกันจึงยังเรียงตามที่โมดูลส่งมา
  // แต่ action หลักจะอยู่ ดู -> แก้ไข -> ยกเลิก -> ลบ เหมือนกันทุกตาราง แม้ caller จะส่งสลับลำดับ
  const visible = actions
    .filter((action) => !action.hidden)
    .map((action, originalIndex) => ({ action, originalIndex }))
    .sort((left, right) => ACTION_ORDER[left.action.kind] - ACTION_ORDER[right.action.kind] || left.originalIndex - right.originalIndex)
    .map(({ action }) => action);
  if (visible.length === 0) return <span className="text-xs text-slate-400">—</span>;

  const preset = pending ? PRESETS[pending.kind] : null;
  const endpointRequiresReason = Boolean(pending?.deleteEndpoint || pending?.archiveEndpoint);
  const reasonRequired = Boolean(pending?.reasonLabel) || endpointRequiresReason;

  return (
    <>
      <div
        data-ui="row-actions"
        className={cn('flex max-w-full flex-wrap items-center justify-end gap-2', className)}
        role="group"
        aria-label={`การดำเนินการสำหรับ ${recordLabel}`}
      >
        {visible.map((action, index) => {
          if (action.kind === 'node') {
            return action.permission
              ? <RequirePermission key={index} permission={action.permission}><span className="contents">{action.node}</span></RequirePermission>
              : <span key={index} className="contents">{action.node}</span>;
          }
          const base = PRESETS[action.kind];
          const Icon = action.icon ?? base.icon;
          const label = action.label ?? base.label;
          const content = <><Icon className="h-4 w-4 shrink-0" aria-hidden /><span className={iconOnly ? 'sr-only' : 'min-w-0 whitespace-normal text-left'}>{label}</span></>;
          const buttonClassName = cn(BUTTON_CLASS, iconOnly && 'w-11 px-0', base.tone);

          const button = action.to && !action.disabled
            ? inRouter
              ? <ContextualActionLink key={index} to={action.to} state={action.state} title={label} aria-label={`${label} ${recordLabel}`} className={buttonClassName}>{content}</ContextualActionLink>
              : <a key={index} href={action.to} title={label} aria-label={`${label} ${recordLabel}`} className={buttonClassName}>{content}</a>
            : (
              <button
                key={index}
                type="button"
                title={label}
                disabled={action.disabled}
                aria-label={`${label} ${recordLabel}`}
                onClick={() => { if (!base.needsConfirm) { action.onClick?.(); return; } setReason(''); setPending(action); }}
                className={buttonClassName}
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
            : pending.kind === 'archive'
              ? 'รายการจะหายจากงานที่กำลังใช้ แต่ยังคงเก็บไว้ในระบบเพื่อตรวจสอบย้อนหลัง'
              : 'รายการจะถูกยกเลิกแต่ยังคงอยู่ในระบบเพื่อการตรวจสอบย้อนหลัง')}
          tone={pending.kind === 'delete' ? 'danger' : 'primary'}
          confirmLabel={pending.confirmLabel ?? (pending.kind === 'delete' ? 'ลบข้อมูล' : pending.kind === 'archive' ? 'ยืนยันเก็บถาวร' : 'ยืนยันยกเลิก')}
          cancelLabel="ไม่ใช่ตอนนี้"
          isPending={pending.isPending || endpointDeletePending}
          testId="row-actions-confirm"
          confirmDisabled={reasonRequired && reason.trim().length < (endpointRequiresReason ? 3 : 1)}
          onConfirm={() => {
            const endpoint = pending.archiveEndpoint ?? pending.deleteEndpoint;
            if (endpoint) {
              void mutateFromEndpoint(endpoint, reason.trim());
              return;
            }
            pending.onConfirm?.(reason.trim());
            setPending(null);
          }}
          onClose={() => setPending(null)}
        >
          {reasonRequired && (
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
              {pending.reasonLabel ?? 'เหตุผล'} <span className="text-rose-600">*</span>
              <textarea
                data-autofocus
                data-testid="row-actions-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={pending.reasonPlaceholder ?? 'ระบุเหตุผลอย่างน้อย 3 ตัวอักษร'}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-primary-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
          )}
        </ConfirmModal>
      )}
    </>
  );
}
