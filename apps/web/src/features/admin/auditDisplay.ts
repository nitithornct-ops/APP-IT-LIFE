/**
 * แปลง detail ของ Audit Log ให้อ่านออกโดยไม่ต้องอ่าน JSON
 *
 * ฝั่ง api เก็บผลเทียบก่อน/หลังไว้ใน detail.changes มาตั้งแต่ต้น (services/auditService)
 * แต่หน้าจอเดิม JSON.stringify ทั้งก้อนลงในช่องที่ตัดข้อความ ผู้ตรวจสอบจึงตอบคำถามหลัก
 * ของงาน ISMS ไม่ได้เลยว่า "ฟิลด์ไหนเปลี่ยน จากอะไรเป็นอะไร" ทั้งที่ข้อมูลมีอยู่ครบ
 */

export interface AuditChange {
  field: string;
  label: string;
  from: unknown;
  to: unknown;
}

/**
 * ชื่อคอลัมน์ที่พบบ่อยในฐานข้อมูล → ชื่อที่คนอ่านออก
 *
 * ครอบคลุมเท่าที่เจอจริงเท่านั้น คอลัมน์ที่ไม่อยู่ในนี้จะแสดงชื่อดิบ ซึ่งยังตรวจสอบได้
 * ดีกว่าเดาชื่อไทยผิดแล้วผู้ตรวจสอบเข้าใจคนละเรื่องกับข้อมูลจริง
 */
const FIELD_LABELS: Record<string, string> = {
  status: 'สถานะ',
  title: 'เรื่อง',
  name: 'ชื่อ',
  priority: 'ความเร่งด่วน',
  severity: 'ความรุนแรง',
  category: 'ประเภท',
  category_id: 'ประเภท',
  assignee_id: 'ผู้รับผิดชอบ',
  requester_id: 'ผู้แจ้ง',
  owner_employee_id: 'ผู้ถือครอง',
  department_id: 'แผนก',
  position_id: 'ตำแหน่ง',
  location: 'สถานที่',
  due_at: 'ครบกำหนด SLA',
  resolved_at: 'เวลาแก้เสร็จ',
  closed_at: 'เวลาปิดงาน',
  acknowledged_at: 'เวลารับเรื่อง',
  sla_paused_at: 'เวลาที่หยุดนับ SLA',
  sla_paused_minutes: 'นาทีที่หยุดนับ SLA',
  resolution: 'ผลการแก้ไข',
  asset_code: 'รหัสทรัพย์สิน',
  serial_number: 'Serial Number',
  employee_code: 'รหัสพนักงาน',
  first_name_th: 'ชื่อ',
  last_name_th: 'นามสกุล',
  email: 'อีเมล',
  username_ad: 'บัญชี AD',
  loan_date: 'วันที่เริ่มถือครอง',
  loan_due_date: 'กำหนดคืน',
  criticality: 'ความสำคัญ',
  risk_score: 'คะแนนความเสี่ยง',
  price: 'ราคา',
  notes: 'หมายเหตุ',
  remark: 'หมายเหตุ',
};

export function auditFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * รายการฟิลด์ที่เปลี่ยนจริง เรียงตามชื่อที่แสดง เพื่อให้อ่านรายการยาว ๆ ได้อย่างคาดเดาได้
 * คืนอาร์เรย์ว่างเมื่อ log นี้ไม่ใช่การแก้ไข (เช่น การเข้าสู่ระบบ หรือการส่งออกข้อมูล)
 */
export function auditChanges(detail: unknown): AuditChange[] {
  const changes = asRecord(asRecord(detail)?.changes);
  if (!changes) return [];
  return Object.entries(changes)
    .map(([field, value]) => {
      const entry = asRecord(value);
      return { field, label: auditFieldLabel(field), from: entry?.from ?? null, to: entry?.to ?? null };
    })
    .sort((left, right) => left.label.localeCompare(right.label, 'th-TH'));
}

/** ค่าที่เหลือใน detail ที่ไม่ใช่ผลเทียบก่อน/หลัง เช่น ตัวกรองของการส่งออก หรือเหตุผลที่ถูกปฏิเสธ */
export function auditContext(detail: unknown): [string, unknown][] {
  const record = asRecord(detail);
  if (!record) return [];
  return Object.entries(record).filter(([key]) => key !== 'changes' && key !== 'changedFields');
}

const EMPTY_LABEL = '(ว่าง)';

/** แสดงค่าให้อ่านออก โดยไม่กลืนความต่างระหว่าง "ว่าง" กับ "ข้อความว่า null" */
export function auditValueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY_LABEL;
  if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่ใช่';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * ข้อความสั้นสำหรับช่องในตาราง — บอกว่าเปลี่ยนกี่ฟิลด์และฟิลด์ไหนบ้าง
 * ไม่ยัดค่าก่อน/หลังลงไปด้วย เพราะช่องในตารางแคบเกินกว่าจะอ่านได้ครบ จึงให้ไปดูในหน้าต่างรายละเอียด
 */
export function auditSummary(detail: unknown): string {
  const changes = auditChanges(detail);
  if (changes.length > 0) {
    const names = changes.slice(0, 3).map((change) => change.label).join(', ');
    return changes.length > 3
      ? `แก้ไข ${changes.length} ฟิลด์: ${names} และอีก ${changes.length - 3}`
      : `แก้ไข ${changes.length} ฟิลด์: ${names}`;
  }

  const context = auditContext(detail);
  if (context.length === 0) return '—';
  return context.map(([key, value]) => `${auditFieldLabel(key)}: ${auditValueText(value)}`).join(' · ');
}

/** log นี้มีอะไรให้กางดูไหม — ใช้ตัดสินว่าจะแสดงปุ่มดูรายละเอียดหรือไม่ */
export function hasAuditDetail(detail: unknown): boolean {
  return auditChanges(detail).length > 0 || auditContext(detail).length > 0;
}

/**
 * ข้อความเต็มของสิ่งที่เปลี่ยน สำหรับไฟล์ที่ส่งออก
 *
 * ต่างจาก auditSummary ตรงที่ใส่ค่าก่อน/หลังมาด้วยครบทุกฟิลด์ — ในไฟล์ไม่มีปุ่มให้กางดู
 * ถ้าใส่แค่ชื่อฟิลด์ ผู้ตรวจสอบที่ทำงานจากไฟล์จะเสียข้อมูลที่หน้าจอมีให้
 */
export function auditChangesText(detail: unknown): string {
  const changes = auditChanges(detail);
  const context = auditContext(detail);

  const parts = changes.map((change) => `${change.label}: ${auditValueText(change.from)} → ${auditValueText(change.to)}`);
  for (const [key, value] of context) parts.push(`${auditFieldLabel(key)}: ${auditValueText(value)}`);

  return parts.length > 0 ? parts.join(' | ') : '—';
}
