/**
 * Mobile Field Workflow — สรุปข้อมูลเครื่องสำหรับช่างที่ยืนอยู่หน้าเครื่องจริง
 *
 * ต่างจากหน้า Asset detail บนเดสก์ท็อปตรงที่ช่างหน้างานต้องการคำตอบสามข้อภายในไม่กี่วินาที:
 * เครื่องนี้คือเครื่องอะไร, เคยซ่อมเรื่องนี้มาก่อนหรือเปล่า, และตอนนี้มีใบงานค้างอยู่ไหม
 *
 * "ซ่อมซ้ำ" คำนวณจาก Ticket จริงที่ผูกกับเครื่องนี้ในหน้าต่างเวลาที่กำหนด ไม่ใช่ธงที่ตั้งด้วยมือ —
 * เครื่องที่กลับมาซ่อมซ้ำในรอบสั้น ๆ มักไม่ใช่อาการเดิมที่ยังแก้ไม่จบ ก็เป็นเครื่องที่ควรพิจารณาเปลี่ยน
 */

type Row = Record<string, unknown>;

/** จำนวนครั้งขั้นต่ำในหน้าต่างเวลาที่ถือว่าเป็น "ซ่อมซ้ำ" — ตรงกับกล่องแดงใน mockup 3j */
export const REPEAT_REPAIR_THRESHOLD = 3;
/** หน้าต่างเวลาที่ใช้ตัดสินว่าซ่อมซ้ำ นับถอยหลังจากวันนี้ */
export const REPEAT_REPAIR_WINDOW_DAYS = 90;

const TERMINAL_TICKET_STATUSES = new Set(['เสร็จสิ้น', 'ปิดงาน', 'ยกเลิก', 'ยกระดับเป็น Incident']);
/** งานที่ถูกยกเลิกไม่ใช่การซ่อม จึงไม่นับเข้าสถิติซ่อมซ้ำ */
const NON_REPAIR_STATUSES = new Set(['ยกเลิก']);

export interface AssetFieldTicket {
  id: string;
  ticketNo: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string | null;
  closedAt: string | null;
  dueAt: string | null;
  overdue: boolean;
  assigneeName: string | null;
}

export interface AssetFieldSummary {
  asset: {
    id: string;
    assetCode: string;
    name: string;
    assetType: string | null;
    brand: string | null;
    model: string | null;
    serialNumber: string | null;
    location: string | null;
    status: string | null;
    warrantyExpire: string | null;
    warrantyActive: boolean | null;
    categoryName: string | null;
    ownerName: string | null;
  };
  repeatRepair: {
    windowDays: number;
    threshold: number;
    count: number;
    isRepeat: boolean;
    lastRepairedAt: string | null;
  };
  openTickets: AssetFieldTicket[];
  history: AssetFieldTicket[];
  /** 'organization' = เห็น Ticket ของเครื่องนี้ครบทุกใบ, 'personal' = เห็นเฉพาะใบที่ตนเกี่ยวข้อง */
  historyScope: 'organization' | 'personal';
  historySampled: boolean;
  generatedAt: string;
}

function text(row: Row, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? '' : String(value);
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined || value === '' ? null : String(value);
}

function validDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function related(row: Row, key: string): Row | null {
  const value = row[key];
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? null;
  return value && typeof value === 'object' ? (value as Row) : null;
}

/**
 * ดึงรหัสทรัพย์สินออกจากข้อความที่สแกนได้
 *
 * QR ที่ระบบสร้าง (buildAssetQrUrl) เก็บข้อความ "{asset_code} | {name}" ไม่ใช่ URL จึงต้องตัดส่วนชื่อทิ้ง
 * รองรับรูปแบบ URL ด้วยเผื่อ QR รุ่นถัดไปเปลี่ยนไปฝัง deep link — ป้ายที่พิมพ์ไปแล้วจะได้ยังสแกนได้อยู่
 * คืน null เมื่อหาอะไรที่ดูเหมือนรหัสไม่เจอ เพื่อให้หน้าจอบอกว่าสแกนไม่ผ่านแทนการยิง query ด้วยขยะ
 */
export function parseScannedAssetCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate);
      const fromQuery = url.searchParams.get('code') ?? url.searchParams.get('data');
      const lastSegment = url.pathname.split('/').filter(Boolean).pop() ?? '';
      candidate = fromQuery || lastSegment;
    } catch {
      return null;
    }
  }

  // "AS-NB-2608ABC | Notebook ฝ่ายบัญชี" -> "AS-NB-2608ABC"
  const [head] = candidate.split('|');
  const code = head.trim();
  if (!code || code.length > 64) return null;
  // รหัสทรัพย์สินของระบบเป็นตัวอักษร/ตัวเลข/ขีด เท่านั้น (generateAssetCode)
  return /^[A-Za-z0-9._-]+$/.test(code) ? code : null;
}

function normalizeTicket(row: Row, now: Date): AssetFieldTicket {
  const dueAt = validDate(row.due_at);
  const status = text(row, 'status');
  const assignee = related(row, 'assignee');
  return {
    id: text(row, 'id'),
    ticketNo: text(row, 'ticket_no'),
    title: text(row, 'title'),
    status,
    priority: text(row, 'priority'),
    createdAt: nullableText(row, 'created_at'),
    closedAt: nullableText(row, 'closed_at') ?? nullableText(row, 'resolved_at'),
    dueAt: nullableText(row, 'due_at'),
    overdue: Boolean(dueAt && !TERMINAL_TICKET_STATUSES.has(status) && dueAt.getTime() < now.getTime()),
    assigneeName: assignee ? String(assignee.full_name ?? '') || null : nullableText(row, 'assignee_name_snapshot'),
  };
}

export function buildAssetFieldSummary(args: {
  asset: Row;
  tickets: Row[];
  historyScope: 'organization' | 'personal';
  ticketTotal?: number;
  now?: Date;
}): AssetFieldSummary {
  const now = args.now ?? new Date();
  const tickets = args.tickets.map((row) => normalizeTicket(row, now));

  const openTickets = tickets
    .filter((ticket) => !TERMINAL_TICKET_STATUSES.has(ticket.status))
    .sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  const history = tickets
    .slice()
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, 20);

  const windowStart = new Date(now.getTime() - REPEAT_REPAIR_WINDOW_DAYS * 86_400_000);
  const repairsInWindow = tickets.filter((ticket) => {
    if (NON_REPAIR_STATUSES.has(ticket.status)) return false;
    const opened = validDate(ticket.createdAt);
    return Boolean(opened && opened >= windowStart && opened <= now);
  });
  const lastRepairedAt = repairsInWindow
    .map((ticket) => ticket.closedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  const asset = args.asset;
  const warrantyExpire = validDate(asset.warranty_expire);
  const category = related(asset, 'asset_categories') ?? related(asset, 'category');
  const owner = related(asset, 'owner');

  return {
    asset: {
      id: text(asset, 'id'),
      assetCode: text(asset, 'asset_code'),
      name: text(asset, 'name'),
      assetType: nullableText(asset, 'asset_type'),
      brand: nullableText(asset, 'brand'),
      model: nullableText(asset, 'model'),
      serialNumber: nullableText(asset, 'serial_number'),
      location: nullableText(asset, 'location'),
      status: nullableText(asset, 'status'),
      warrantyExpire: nullableText(asset, 'warranty_expire'),
      warrantyActive: warrantyExpire ? warrantyExpire.getTime() >= now.getTime() : null,
      categoryName: category ? String(category.name ?? '') || null : null,
      ownerName: owner
        ? [owner.prefix_th, owner.first_name_th, owner.last_name_th].filter(Boolean).map(String).join(' ') || null
        : null,
    },
    repeatRepair: {
      windowDays: REPEAT_REPAIR_WINDOW_DAYS,
      threshold: REPEAT_REPAIR_THRESHOLD,
      count: repairsInWindow.length,
      isRepeat: repairsInWindow.length >= REPEAT_REPAIR_THRESHOLD,
      lastRepairedAt,
    },
    openTickets,
    history,
    historyScope: args.historyScope,
    historySampled: (args.ticketTotal ?? tickets.length) > tickets.length,
    generatedAt: now.toISOString(),
  };
}
