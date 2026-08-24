import { AlertTriangle, Clock3 } from 'lucide-react';
import type { ReactNode } from 'react';
import { StatusBadge, type StatusTone } from './StatusBadge';

export interface SlaDisplay {
  state: 'overdue' | 'dueSoon';
  tone: Extract<StatusTone, 'danger' | 'warning'>;
  label: string;
}

/** แสดงป้ายเฉพาะ SLA ที่เกินกำหนดหรือใกล้ครบกำหนด ส่วนกรณีปกติเป็นข้อความกลาง */
export function SlaBadge({ display, fallback }: { display: SlaDisplay | null; fallback?: ReactNode }) {
  if (!display) {
    return <span className="font-mono text-[11px] text-slate-500 dark:text-white/45">{fallback ?? '—'}</span>;
  }
  return (
    <StatusBadge
      display={{
        label: display.label,
        tone: display.tone,
        icon: display.state === 'overdue'
          ? <AlertTriangle className="h-3.5 w-3.5" />
          : <Clock3 className="h-3.5 w-3.5" />,
      }}
    />
  );
}
