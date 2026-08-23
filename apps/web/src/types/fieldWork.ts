/** ตรงกับ apps/api/src/services/assetFieldService.ts */

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
  /** 'personal' = ผู้ใช้ไม่มี ticket.view_all จึงเห็นเฉพาะใบที่ตนเกี่ยวข้อง ประวัติที่แสดงไม่ครบ */
  historyScope: 'organization' | 'personal';
  historySampled: boolean;
  generatedAt: string;
}

/** ตัวเลือกผลการแก้ไข — สร้างจาก state machine ฝั่ง API (fieldOutcomesFor) */
export interface FieldOutcome {
  status: string;
  label: string;
  description: string;
  requiresResolution: boolean;
  tone: 'success' | 'warning' | 'primary';
}

/** ส่วนของ Ticket ที่จอปิดงานหน้างานต้องใช้ */
export interface FieldCloseTicket {
  id: string;
  ticket_no: string;
  title: string;
  status: string;
  /** ใช้กรองรหัสสาเหตุให้เหลือเฉพาะที่เกี่ยวกับงานหมวดนี้ */
  category_id: string | null;
  resolution: string | null;
  cause_code_id: string | null;
  field_outcomes: FieldOutcome[];
}

/** อะไหล่หนึ่งรายการที่ช่างเลือกไว้ว่าใช้ไปกับงานนี้ */
export interface PartUsage {
  itemId: string;
  itemName: string;
  unit: string;
  stockQty: number;
  qty: number;
}
