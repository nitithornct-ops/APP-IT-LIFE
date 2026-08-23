import { describe, expect, it } from 'vitest';
import {
  buildAssetFieldSummary,
  parseScannedAssetCode,
  REPEAT_REPAIR_THRESHOLD,
  REPEAT_REPAIR_WINDOW_DAYS,
} from '../src/services/assetFieldService';

const NOW = new Date('2026-08-23T10:00:00.000Z');

const ASSET = {
  id: 'asset-1',
  asset_code: 'AS-NB-2608ABC',
  name: 'Notebook ฝ่ายบัญชี',
  asset_type: 'Notebook',
  brand: 'Dell',
  model: 'Latitude 5440',
  serial_number: 'SN-12345',
  location: 'ชั้น 3 ห้องบัญชี',
  status: 'ใช้งาน',
  warranty_expire: '2027-01-31',
  category: { id: 'cat-1', name: 'คอมพิวเตอร์พกพา' },
  owner: { prefix_th: 'นาย', first_name_th: 'สมชาย', last_name_th: 'ใจดี' },
};

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    ticket_no: 'TCK-001',
    title: 'เปิดเครื่องไม่ติด',
    status: 'ปิดงาน',
    priority: 'ปานกลาง',
    created_at: '2026-08-01T03:00:00.000Z',
    resolved_at: '2026-08-02T03:00:00.000Z',
    closed_at: '2026-08-02T04:00:00.000Z',
    due_at: null,
    assignee_name_snapshot: 'ช่างวรุณ',
    ...overrides,
  };
}

describe('parseScannedAssetCode', () => {
  it('reads the code out of the "code | name" text the system QR actually encodes', () => {
    expect(parseScannedAssetCode('AS-NB-2608ABC | Notebook ฝ่ายบัญชี')).toBe('AS-NB-2608ABC');
    expect(parseScannedAssetCode('  AS-NB-2608ABC  ')).toBe('AS-NB-2608ABC');
  });

  it('also accepts a URL form so future deep-link labels keep working', () => {
    expect(parseScannedAssetCode('https://it.life.local/field/asset/AS-NB-2608ABC')).toBe('AS-NB-2608ABC');
    expect(parseScannedAssetCode('https://it.life.local/field?code=AS-NB-2608ABC')).toBe('AS-NB-2608ABC');
  });

  it('keeps the exact casing the technician typed, so the caller can spot a case-variant clash', () => {
    // assets_asset_code_unique แยกตัวพิมพ์ ทะเบียนจึงมี as-nb-001 กับ AS-NB-001 พร้อมกันได้
    expect(parseScannedAssetCode('as-nb-001')).toBe('as-nb-001');
    expect(parseScannedAssetCode('AS-NB-001 | Notebook')).toBe('AS-NB-001');
  });

  it('refuses junk instead of querying the database with it', () => {
    expect(parseScannedAssetCode('')).toBeNull();
    expect(parseScannedAssetCode('   ')).toBeNull();
    expect(parseScannedAssetCode('รหัส ที่มีช่องว่าง')).toBeNull();
    expect(parseScannedAssetCode("AS-1'; drop table assets;--")).toBeNull();
    expect(parseScannedAssetCode('http://[bad-url')).toBeNull();
    expect(parseScannedAssetCode('A'.repeat(65))).toBeNull();
  });
});

describe('buildAssetFieldSummary', () => {
  it('summarises the machine and flags nothing when it has no repair history', () => {
    const summary = buildAssetFieldSummary({ asset: ASSET, tickets: [], historyScope: 'organization', now: NOW });

    expect(summary.asset).toMatchObject({
      assetCode: 'AS-NB-2608ABC',
      brand: 'Dell',
      serialNumber: 'SN-12345',
      categoryName: 'คอมพิวเตอร์พกพา',
      ownerName: 'นาย สมชาย ใจดี',
      warrantyActive: true,
    });
    expect(summary.repeatRepair).toMatchObject({ count: 0, isRepeat: false, lastRepairedAt: null });
    expect(summary.openTickets).toEqual([]);
    expect(summary.history).toEqual([]);
  });

  it('flags a repeat repair only once the real ticket count reaches the threshold', () => {
    const withinWindow = Array.from({ length: REPEAT_REPAIR_THRESHOLD }, (_, index) =>
      ticket({ id: `t-${index}`, ticket_no: `TCK-00${index}`, created_at: `2026-08-0${index + 1}T03:00:00.000Z` }),
    );

    const below = buildAssetFieldSummary({ asset: ASSET, tickets: withinWindow.slice(0, REPEAT_REPAIR_THRESHOLD - 1), historyScope: 'organization', now: NOW });
    expect(below.repeatRepair.isRepeat).toBe(false);

    const atThreshold = buildAssetFieldSummary({ asset: ASSET, tickets: withinWindow, historyScope: 'organization', now: NOW });
    expect(atThreshold.repeatRepair).toMatchObject({
      count: REPEAT_REPAIR_THRESHOLD,
      isRepeat: true,
      windowDays: REPEAT_REPAIR_WINDOW_DAYS,
    });
  });

  it('ignores cancelled tickets and anything older than the window when counting repeats', () => {
    const summary = buildAssetFieldSummary({
      asset: ASSET,
      tickets: [
        ticket({ id: 't-1', created_at: '2026-08-01T03:00:00.000Z' }),
        ticket({ id: 't-2', created_at: '2026-08-05T03:00:00.000Z', status: 'ยกเลิก' }),
        ticket({ id: 't-3', created_at: '2025-01-05T03:00:00.000Z' }),
      ],
      historyScope: 'organization',
      now: NOW,
    });

    expect(summary.repeatRepair.count).toBe(1);
    expect(summary.repeatRepair.isRepeat).toBe(false);
    // ประวัติยังแสดงครบทุกใบ เรียงใหม่ไปเก่า แม้บางใบไม่ถูกนับเป็นการซ่อมซ้ำ
    expect(summary.history.map((item) => item.id)).toEqual(['t-2', 't-1', 't-3']);
  });

  it('separates work still open on the machine and marks the overdue one first', () => {
    const summary = buildAssetFieldSummary({
      asset: ASSET,
      tickets: [
        ticket({ id: 'open-1', status: 'กำลังดำเนินการ', created_at: '2026-08-20T03:00:00.000Z', closed_at: null, resolved_at: null, due_at: '2026-08-30T03:00:00.000Z' }),
        ticket({ id: 'open-2', status: 'รออะไหล่', created_at: '2026-08-18T03:00:00.000Z', closed_at: null, resolved_at: null, due_at: '2026-08-19T03:00:00.000Z' }),
        ticket({ id: 'done-1', status: 'ปิดงาน', created_at: '2026-08-10T03:00:00.000Z' }),
      ],
      historyScope: 'organization',
      now: NOW,
    });

    expect(summary.openTickets.map((item) => item.id)).toEqual(['open-2', 'open-1']);
    expect(summary.openTickets[0].overdue).toBe(true);
    expect(summary.openTickets[1].overdue).toBe(false);
  });

  it('never marks a closed ticket overdue even when its due date has passed', () => {
    const summary = buildAssetFieldSummary({
      asset: ASSET,
      tickets: [ticket({ id: 'done-late', status: 'ปิดงาน', due_at: '2026-08-01T03:00:00.000Z' })],
      historyScope: 'organization',
      now: NOW,
    });

    expect(summary.openTickets).toEqual([]);
    expect(summary.history[0].overdue).toBe(false);
  });

  it('reports a personal history scope and truncation instead of implying the list is complete', () => {
    const summary = buildAssetFieldSummary({
      asset: ASSET,
      tickets: [ticket()],
      historyScope: 'personal',
      ticketTotal: 42,
      now: NOW,
    });

    expect(summary.historyScope).toBe('personal');
    expect(summary.historySampled).toBe(true);
  });

  it('prefers the joined assignee name and falls back to the snapshot', () => {
    const summary = buildAssetFieldSummary({
      asset: ASSET,
      tickets: [
        ticket({ id: 'joined', assignee: { full_name: 'ช่างปัจจุบัน' } }),
        ticket({ id: 'snapshot', created_at: '2026-07-01T03:00:00.000Z' }),
      ],
      historyScope: 'organization',
      now: NOW,
    });

    expect(summary.history.find((item) => item.id === 'joined')!.assigneeName).toBe('ช่างปัจจุบัน');
    expect(summary.history.find((item) => item.id === 'snapshot')!.assigneeName).toBe('ช่างวรุณ');
  });

  it('reports an expired warranty as expired rather than unknown', () => {
    const summary = buildAssetFieldSummary({
      asset: { ...ASSET, warranty_expire: '2026-01-01' },
      tickets: [],
      historyScope: 'organization',
      now: NOW,
    });
    expect(summary.asset.warrantyActive).toBe(false);

    const noWarranty = buildAssetFieldSummary({
      asset: { ...ASSET, warranty_expire: null },
      tickets: [],
      historyScope: 'organization',
      now: NOW,
    });
    expect(noWarranty.asset.warrantyActive).toBeNull();
  });
});
