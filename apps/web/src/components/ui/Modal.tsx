import { AlertTriangle, Trash2, X } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn';
import { Button } from './Button';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';
type ModalContentPadding = 'none' | 'compact' | 'default';

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
};

const contentPaddingClasses: Record<ModalContentPadding, string> = {
  none: '',
  compact: 'px-4 py-4 sm:px-5',
  default: 'px-5 py-5 sm:px-6 sm:py-6',
};

interface ModalStackEntry { id: number; depth: number }

const ModalDepthContext = createContext(0);
const modalStack: ModalStackEntry[] = [];
let nextModalId = 0;

/**
 * ชั้นความสูงของ overlay กำหนดไว้ที่เดียวเพื่อไม่ให้แต่ละคอมโพเนนต์เดาเลขกันเอง
 *
 * React context ติดตามความลึกจริงข้าม portal ได้ จึงไม่ขึ้นกับลำดับ effect หรือจำนวน modal ที่เคยเปิด
 * ก่อนหน้านี้หมายเลขสะสมอาจทำให้ modal แม่ได้ z-index สูงกว่าลูกหลังเปิด/ปิดหลายรอบจนลูกกดไม่ได้
 * และเลขที่ไต่ขึ้นเรื่อย ๆ ยังเคยแซงชั้น Toast อีกด้วย
 */
const MODAL_BASE_Z = 50;
/** เพดานที่ยอมให้ดันชั้นขึ้น กันกรณีซ้อนผิดปกติไม่ให้ไปแตะชั้นของ Toast */
const MODAL_MAX_DEPTH = 9;

interface ModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  description?: ReactNode;
  icon?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  closeDisabled?: boolean;
  closeOnBackdrop?: boolean;
  isDirty?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  contentClassName?: string;
  /** Standard inner gutter. Base Modal stays edge-to-edge; form/detail variants add it by default. */
  contentPadding?: ModalContentPadding;
  testId?: string;
  closeTestId?: string;
}

export function Modal({
  title,
  children,
  onClose,
  description,
  icon,
  footer,
  size = 'md',
  closeDisabled = false,
  closeOnBackdrop = true,
  isDirty = false,
  initialFocusRef,
  className,
  contentClassName,
  contentPadding = 'none',
  testId,
  closeTestId,
}: ModalProps) {
  const titleId = useId();
  const depth = useContext(ModalDepthContext);
  const [instanceId] = useState(() => ++nextModalId);
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const discardDialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  const isDirtyRef = useRef(isDirty);
  const showDiscardConfirmRef = useRef(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
    isDirtyRef.current = isDirty;
  }, [closeDisabled, isDirty, onClose]);

  useEffect(() => {
    showDiscardConfirmRef.current = showDiscardConfirm;
    if (!showDiscardConfirm) return;
    const focusTimer = window.setTimeout(() => {
      discardDialogRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
    });
    return () => window.clearTimeout(focusTimer);
  }, [showDiscardConfirm]);

  const requestClose = () => {
    if (closeDisabledRef.current) return;
    if (isDirtyRef.current) {
      setShowDiscardConfirm(true);
      return;
    }
    onCloseRef.current();
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    modalStack.push({ id: instanceId, depth });
    const focusTimer = window.setTimeout(() => {
      const preferredFocus = initialFocusRef?.current
        ?? dialogRef.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
      (preferredFocus ?? closeButtonRef.current)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const topmost = modalStack.reduce<ModalStackEntry | null>(
        (current, entry) => !current || entry.depth >= current.depth ? entry : current,
        null,
      );
      if (topmost?.id !== instanceId) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        // Closing the child can synchronously remove it from modalStack while the
        // same document event is still reaching the parent listener. Stop that
        // event here so one Escape never closes two nested dialogs.
        event.stopImmediatePropagation();
        if (showDiscardConfirmRef.current) setShowDiscardConfirm(false);
        else if (!closeDisabledRef.current) requestClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const activeDialog = showDiscardConfirmRef.current ? discardDialogRef.current : dialogRef.current;
      const focusable = Array.from(
        activeDialog?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const stackIndex = modalStack.map((entry) => entry.id).lastIndexOf(instanceId);
      if (stackIndex >= 0) modalStack.splice(stackIndex, 1);
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [depth, initialFocusRef, instanceId]);

  return createPortal(
    <ModalDepthContext.Provider value={depth + 1}>
    <div
      className="global-modal-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-primary-950/55 p-3 backdrop-blur-[3px] sm:items-center sm:p-6"
      style={{ zIndex: MODAL_BASE_Z + Math.min(depth, MODAL_MAX_DEPTH) }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && closeOnBackdrop && !closeDisabled) requestClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-ui="modal"
        data-testid={testId}
        className={cn(
          'global-modal-panel my-auto flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-modal border border-slate-200 bg-white shadow-elevated dark:border-slate-700 dark:bg-slate-800',
          sizeClasses[size],
          className,
        )}
      >
        <header className="flex min-h-16 shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-700">
          <div className="flex min-w-0 items-start gap-3">
            {icon && <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-700 dark:bg-primary-900/50 dark:text-primary-200" aria-hidden="true">{icon}</span>}
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
              {description && <p id={descriptionId} className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            data-testid={closeTestId}
            aria-label="ปิดหน้าต่าง"
            disabled={closeDisabled}
            onClick={requestClose}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-primary-50 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div
          data-modal-content
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain',
            contentPaddingClasses[contentPadding],
            contentClassName,
          )}
        >
          {children}
        </div>
        {footer && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/50">{footer}</footer>}
      </section>

      {showDiscardConfirm && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary-950/50 p-4" role="presentation">
          <section ref={discardDialogRef} role="alertdialog" aria-modal="true" aria-labelledby={`${titleId}-discard`} data-ui="modal-discard" className="global-modal-panel w-full max-w-md rounded-modal border border-slate-200 bg-white p-5 shadow-elevated dark:border-slate-700 dark:bg-slate-800">
            <div className="flex gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded border border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200"><AlertTriangle className="h-5 w-5" aria-hidden="true" /></span>
              <div><h3 id={`${titleId}-discard`} className="font-display font-semibold tracking-[0.02em] text-slate-900 dark:text-white">ออกโดยไม่บันทึก?</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-300">มีข้อมูลที่ยังไม่ได้บันทึก คุณต้องการออกจากหน้านี้หรือไม่</p></div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowDiscardConfirm(false)}>กลับไปแก้ไข</Button>
              <Button type="button" variant="danger" onClick={() => onCloseRef.current()}>ออกโดยไม่บันทึก</Button>
            </div>
          </section>
        </div>
      )}
    </div>
    </ModalDepthContext.Provider>,
    document.body,
  );
}

export const BaseModal = Modal;

export function FormModal({ children, isDirty, contentPadding = 'default', ...props }: ModalProps) {
  const [hasChanges, setHasChanges] = useState(false);
  return <Modal closeOnBackdrop={false} contentPadding={contentPadding} isDirty={isDirty ?? hasChanges} {...props}><div className="min-w-0" onChangeCapture={() => setHasChanges(true)} onInputCapture={() => setHasChanges(true)}>{children}</div></Modal>;
}

export function DetailModal({ contentPadding = 'default', ...props }: ModalProps) {
  return <Modal size="xl" contentPadding={contentPadding} {...props} />;
}

interface ConfirmModalProps {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  isPending?: boolean;
  /** กันการยืนยันจนกว่าเนื้อในกล่อง (เช่น ช่องเหตุผลบังคับ) จะครบ */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  testId?: string;
}

export function ConfirmModal({
  title,
  description,
  children,
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก',
  tone = 'primary',
  isPending = false,
  confirmDisabled = false,
  onConfirm,
  onClose,
  testId,
}: ConfirmModalProps) {
  return (
    <Modal
      title={title}
      description={description}
      icon={tone === 'danger' ? <Trash2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
      size="sm"
      closeOnBackdrop={false}
      closeDisabled={isPending}
      onClose={onClose}
      testId={testId}
      contentPadding="compact"
      footer={<><Button type="button" variant="outline" disabled={isPending} onClick={onClose}>{cancelLabel}</Button><Button type="button" variant={tone === 'danger' ? 'danger' : 'primary'} isLoading={isPending} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button></>}
    >
      {children}
    </Modal>
  );
}

export function DeleteConfirmModal(props: Omit<ConfirmModalProps, 'tone'>) {
  return <ConfirmModal tone="danger" confirmLabel="ลบข้อมูล" {...props} />;
}

export function StatusModal(props: ModalProps) {
  return <FormModal size="md" {...props} />;
}
