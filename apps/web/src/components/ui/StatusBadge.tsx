import type { ReactNode } from 'react';
import { Badge } from './Badge';

export type StatusTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'teal' | 'purple' | 'secondary';

export interface StatusDisplay {
  label: ReactNode;
  tone: StatusTone;
  icon?: ReactNode;
}

/** รับ label/tone ที่แปลงจาก *Display.ts แล้ว เพื่อไม่ให้ presentation component สร้าง mapping ซ้ำ */
export function StatusBadge({ display }: { display: StatusDisplay }) {
  return (
    <Badge variant={display.tone}>
      {display.icon && <span aria-hidden="true">{display.icon}</span>}
      <span>{display.label}</span>
    </Badge>
  );
}
