import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../src/types';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ createAdminClient: () => ({ from: mocks.from }) }));

import {
  appUrl, buildTicketFlexMessage, buildUserNotificationFlexMessage, formatThaiDateTime,
  resolveTicketRequesterLineTarget, resolveUserLineTarget, sendLinePush, type LineMessagePayload,
} from '../src/lib/lineMessaging';

const env = {} as Bindings;

/** ข้อความทุกชิ้นในการ์ด ใช้ยืนยันว่าแถวที่ควรมีถูกวาด และแถวที่ไม่มีค่าถูกตัดทิ้งจริง */
function flexTexts(message: LineMessagePayload): string[] {
  const texts: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') texts.push(record.text);
    Object.values(record).forEach(walk);
  };
  walk(message.contents);
  return texts;
}

function flexFooterContents(message: LineMessagePayload): Record<string, unknown>[] {
  return (message.contents as { footer?: { contents?: Record<string, unknown>[] } }).footer?.contents ?? [];
}

function mockLineRow(row: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row });
  const builder = { eq: vi.fn(() => builder), maybeSingle };
  const select = vi.fn(() => builder);
  mocks.from.mockReturnValue({ select });
  return { builder, select };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('resolveTicketRequesterLineTarget', () => {
  it('uses the direct LINE identity for a LINE-created ticket', async () => {
    const { builder } = mockLineRow({ id: 'line-row-1', line_user_id: 'U123', linked_user_id: 'profile-1', link_status: 'Active' });
    await expect(resolveTicketRequesterLineTarget(env, 'line-row-1', 'profile-1')).resolves.toEqual({
      target: 'U123', lineUserId: 'line-row-1', linkedUserId: 'profile-1',
    });
    expect(builder.eq).toHaveBeenCalledWith('id', 'line-row-1');
  });

  it('finds the linked LINE identity for a web-created ticket', async () => {
    const { builder } = mockLineRow({ id: 'line-row-2', line_user_id: 'U456', linked_user_id: 'profile-2', link_status: 'Active' });
    await expect(resolveTicketRequesterLineTarget(env, null, 'profile-2')).resolves.toEqual({
      target: 'U456', lineUserId: 'line-row-2', linkedUserId: 'profile-2',
    });
    expect(builder.eq).toHaveBeenCalledWith('linked_user_id', 'profile-2');
  });

  it('does not target a suspended LINE identity', async () => {
    mockLineRow({ id: 'line-row-3', line_user_id: 'U789', linked_user_id: 'profile-3', link_status: 'Suspended' });
    await expect(resolveTicketRequesterLineTarget(env, null, 'profile-3')).resolves.toBeNull();
  });

  it('resolves an application notification recipient through the unique profile link', async () => {
    const { builder } = mockLineRow({ id: 'line-row-4', line_user_id: 'U999', linked_user_id: 'profile-4', link_status: 'Active' });
    await expect(resolveUserLineTarget(env, 'profile-4')).resolves.toEqual({ target: 'U999', lineUserId: 'line-row-4' });
    expect(builder.eq).toHaveBeenCalledWith('linked_user_id', 'profile-4');
  });
});

describe('appUrl', () => {
  const appEnv = { PUBLIC_APP_URL: 'https://life-it.pages.dev/' } as Bindings;

  it('builds an absolute in-app link for the card button', () => {
    expect(appUrl(appEnv, '/tickets/abc')).toBe('https://life-it.pages.dev/tickets/abc');
    expect(appUrl(appEnv, '/line?mode=status')).toBe('https://life-it.pages.dev/line?mode=status');
  });

  it('refuses to send the reader anywhere but this deployment', () => {
    expect(appUrl(appEnv, 'https://evil.example/steal')).toBeNull();
    expect(appUrl(appEnv, null)).toBeNull();
    expect(appUrl({} as Bindings, '/tickets/abc')).toBeNull();
  });
});

describe('formatThaiDateTime', () => {
  it('renders Bangkok local time so the reader never converts a timezone', () => {
    expect(formatThaiDateTime('2026-09-05T02:30:00.000Z')).toBe('5 ก.ย. 2569 09:30 น.');
  });

  it('drops a value that is not a real timestamp instead of printing Invalid Date', () => {
    expect(formatThaiDateTime('not-a-date')).toBeNull();
    expect(formatThaiDateTime(null)).toBeNull();
  });
});

describe('buildTicketFlexMessage', () => {
  const fullCard = () => buildTicketFlexMessage({
    eyebrow: 'อัปเดตสถานะแจ้งซ่อม',
    title: 'เครื่องพิมพ์ชั้น 3 ไม่ทำงาน',
    ticketNo: 'TCK-001',
    status: 'เสร็จสิ้น',
    previousStatus: 'กำลังดำเนินการ',
    priority: 'สูง',
    requesterName: 'สมชาย ใจดี',
    fields: [
      { label: 'ผู้รับผิดชอบ', value: 'ช่างสมศักดิ์' },
      { label: 'สถานที่', value: null },
      { label: 'กำหนดเสร็จ', value: formatThaiDateTime('2026-09-05T02:30:00.000Z') },
    ],
    rating: 4,
    detail: 'เปลี่ยนชุดดรัมและทดสอบพิมพ์แล้ว',
    detailLabel: 'สรุปการแก้ไข',
    footnote: 'อัปเดตเมื่อ 5 ก.ย. 2569 09:30 น.',
    url: 'https://life-it.pages.dev/line?mode=status',
    buttonLabel: 'ประเมินและตรวจรับงาน',
  });

  it('shows the ticket context the reader needs without opening the system', () => {
    expect(flexTexts(fullCard())).toEqual(expect.arrayContaining([
      'TCK-001',
      'กำลังดำเนินการ → เสร็จสิ้น',
      'ความเร่งด่วน', 'สูง',
      'ผู้แจ้ง', 'สมชาย ใจดี',
      'ผู้รับผิดชอบ', 'ช่างสมศักดิ์',
      'กำหนดเสร็จ', '5 ก.ย. 2569 09:30 น.',
      'ผลประเมิน', '★★★★☆  4.0/5',
      'สรุปการแก้ไข', 'เปลี่ยนชุดดรัมและทดสอบพิมพ์แล้ว',
      'อัปเดตเมื่อ 5 ก.ย. 2569 09:30 น.',
    ]));
  });

  it('drops a field with no value instead of leaving the reader an empty label', () => {
    expect(flexTexts(fullCard())).not.toContain('สถานที่');
  });

  it('summarises the event in altText, which is all a locked phone shows', () => {
    expect(fullCard().altText).toBe('อัปเดตสถานะแจ้งซ่อม · [TCK-001] · เครื่องพิมพ์ชั้น 3 ไม่ทำงาน · สถานะ: เสร็จสิ้น');
  });

  it('puts the action button first in the footer with the caller\'s label', () => {
    expect(flexFooterContents(fullCard())[0]).toMatchObject({
      type: 'button',
      action: { uri: 'https://life-it.pages.dev/line?mode=status', label: 'ประเมินและตรวจรับงาน' },
    });
  });

  it('keeps a bare card renderable when the event knows almost nothing', () => {
    const minimal = buildTicketFlexMessage({ eyebrow: 'มีรายการแจ้งซ่อมใหม่', title: 'ตรวจสอบเครื่องสำรองไฟ' });
    expect(minimal.contents).toMatchObject({ type: 'bubble' });
    expect(minimal.contents).not.toHaveProperty('footer');
    expect(flexTexts(minimal)).toEqual(['LIFE IT SERVICE', 'มีรายการแจ้งซ่อมใหม่', 'ตรวจสอบเครื่องสำรองไฟ']);
  });

  it('stays inside the 10KB LINE bubble budget even with a long description', () => {
    const long = buildTicketFlexMessage({
      eyebrow: 'มีรายการแจ้งซ่อมใหม่', title: 'ก'.repeat(400), ticketNo: 'TCK-002', status: 'ใหม่',
      detail: 'ข'.repeat(4000), fields: Array.from({ length: 30 }, (_, index) => ({ label: `หัวข้อ ${index}`, value: 'ค'.repeat(400) })),
    });
    expect(JSON.stringify(long.contents).length).toBeLessThan(10_000);
  });
});

describe('buildUserNotificationFlexMessage', () => {
  it('labels and colours the card by notification type so the event is clear at a glance', () => {
    const message = buildUserNotificationFlexMessage({
      type: 'resolution_breached', title: 'TCK-001 ผิด Resolution SLA แล้ว', body: 'เครื่องพิมพ์ชั้น 3 ไม่ทำงาน',
    });
    expect(flexTexts(message)).toEqual(expect.arrayContaining(['ผิด Resolution SLA แล้ว', 'TCK-001 ผิด Resolution SLA แล้ว']));
    expect(message.altText).toBe('LIFE IT · ผิด Resolution SLA แล้ว: TCK-001 ผิด Resolution SLA แล้ว');
    expect((message.contents as { header: { backgroundColor: string } }).header.backgroundColor).toBe('#DC2626');
  });

  it('falls back to a neutral label for a type it has no preset for', () => {
    expect(flexTexts(buildUserNotificationFlexMessage({ type: 'brand_new_event', title: 'ทดสอบ' })))
      .toContain('การแจ้งเตือน');
  });

  it('creates a readable generic card with an optional application link', () => {
    expect(buildUserNotificationFlexMessage({
      title: 'รออนุมัติคำขอสิทธิ์', body: 'กรุณาตรวจสอบคำขอ AR-001', url: 'https://life.example/access-requests/1',
    })).toMatchObject({
      type: 'flex',
      altText: expect.stringContaining('รออนุมัติคำขอสิทธิ์'),
      contents: {
        footer: { contents: [{ action: { uri: 'https://life.example/access-requests/1' } }] },
      },
    });
  });
});

describe('sendLinePush', () => {
  const enabledEnv = { NOTIFY_LINE_ENABLED: 'true', LINE_CHANNEL_ACCESS_TOKEN: 'test-token' } as Bindings;

  function mockNotificationLog() {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({ insert });
    return insert;
  }

  it('returns a successful delivery result and writes the delivery log', async () => {
    const insert = mockNotificationLog();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn() });
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendLinePush(enabledEnv, 'U123', 'test message', 'line-row-1')).resolves.toEqual({ success: true, error: null });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v2/bot/message/push'), expect.objectContaining({ method: 'POST' }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ line_user_id: 'line-row-1', success: true }));
  });

  it('sends a styled Flex Message while keeping the readable delivery log text', async () => {
    const insert = mockNotificationLog();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn() });
    vi.stubGlobal('fetch', fetchMock);
    const flex = buildTicketFlexMessage({
      eyebrow: 'อัปเดตสถานะแจ้งซ่อม', title: 'เครื่องพิมพ์ไม่ทำงาน', ticketNo: 'TCK-001',
      status: 'เสร็จสิ้น', requesterName: 'สมชาย ใจดี', url: 'https://life-it.pages.dev/line?mode=status',
    });

    await sendLinePush(enabledEnv, 'U123', 'TCK-001 เสร็จสิ้น', 'line-row-1', flex);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.messages[0]).toMatchObject({ type: 'flex', contents: { type: 'bubble' } });
    expect(payload.messages[0].altText).toContain('TCK-001');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ message: 'TCK-001 เสร็จสิ้น', success: true }));
  });

  it('returns the LINE API failure and writes a failed delivery log', async () => {
    const insert = mockNotificationLog();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: vi.fn().mockResolvedValue('invalid target') }));

    const result = await sendLinePush(enabledEnv, 'U123', 'test message', 'line-row-1');
    expect(result).toEqual({ success: false, error: 'HTTP 400: invalid target' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'HTTP 400: invalid target' }));
  });

  it('does not call LINE when messaging is disabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendLinePush({} as Bindings, 'U123', 'test message')).resolves.toEqual({
      success: false,
      error: 'LINE Messaging is disabled or incomplete',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
