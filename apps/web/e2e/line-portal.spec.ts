import { expect, test, type Page } from '@playwright/test';

/**
 * พอร์ทัล LINE เป็นหน้าจอมือถือที่ผู้ใช้จริงเปิดจากแอป LINE เท่านั้น จึงทดสอบด้วยการ mock
 * API ทั้งชุดแทนการยิงหลังบ้านจริง สิ่งที่ต้องกันคือโครงหน้าแตกและจอเลื่อนแนวนอน
 */

const PROFILE = {
  displayName: 'Nitithorn',
  pictureUrl: '',
  fullName: 'นิธิธร ชูเกียรติ',
  department: 'ฝ่ายบัญชีและการเงิน',
  linkStatus: 'Active',
  friendStatus: 'Friend',
};

const BASE_TICKET = {
  priority: 'สูง',
  response_due_at: null,
  resolved_at: null,
  rating: null,
  location: 'อาคาร A ชั้น 3',
  category: { name: 'คอมพิวเตอร์ / โน้ตบุ๊ก' },
};

const TICKETS = [
  {
    ...BASE_TICKET,
    id: 'ticket-open',
    ticket_no: 'TK-2608-0142',
    title: 'โน้ตบุ๊กเปิดไม่ติด หน้าจอดำ',
    status: 'กำลังดำเนินการ',
    created_at: '2026-08-29T02:12:00.000Z',
    updated_at: '2026-08-29T06:40:00.000Z',
    due_at: '2126-08-29T09:00:00.000Z',
    closed_at: null,
    assignee_name_snapshot: 'วีระ ทองดี',
    asset_name_snapshot: 'โน้ตบุ๊ก IT-NB-0142',
  },
  {
    ...BASE_TICKET,
    id: 'ticket-awaiting',
    ticket_no: 'TK-2608-0121',
    title: 'ระบบ ERP เข้าใช้งานไม่ได้',
    status: 'เสร็จสิ้น',
    created_at: '2026-08-28T02:00:00.000Z',
    updated_at: '2026-08-29T04:00:00.000Z',
    due_at: null,
    closed_at: null,
    assignee_name_snapshot: 'สมเกียรติ พูนผล',
    asset_name_snapshot: null,
  },
  {
    ...BASE_TICKET,
    id: 'ticket-closed',
    ticket_no: 'TK-2608-0097',
    title: 'ตั้งอีเมลบนเครื่องใหม่และย้ายข้อมูล',
    status: 'ปิดงาน',
    created_at: '2026-08-20T02:00:00.000Z',
    updated_at: '2026-08-21T03:02:00.000Z',
    due_at: null,
    closed_at: '2026-08-21T03:02:00.000Z',
    assignee_name_snapshot: 'วีระ ทองดี',
    asset_name_snapshot: null,
  },
];

const DETAIL = {
  ticket: {
    ...TICKETS[0],
    description: 'กดปุ่มเปิดแล้วไฟสถานะติด แต่หน้าจอไม่ขึ้นภาพ ลองต่อจอนอกแล้วยังไม่ติด เริ่มเป็นเมื่อเช้าวันนี้',
    resolution: null,
    requester_name_snapshot: PROFILE.fullName,
    department_name_snapshot: PROFILE.department,
    requester_phone: 'ต่อ 1204',
    source_channel: 'line',
    rating_details: null,
    rating_criteria_snapshot: null,
    signature_url: null,
    requester_signature_url: null,
    requester_signature_uploaded_at: null,
  },
  ratingCriteria: [],
  worklogs: [
    {
      id: 'log-1', entry_type: 'timeline', action: 'ผู้ใช้งานแจ้งเรื่องผ่าน LINE Service Portal',
      detail: 'แนบรูป 2 ไฟล์ · ระดับความสำคัญ สูง', status_from: null, status_to: 'ใหม่',
      created_at: '2026-08-29T02:12:00.000Z', actor_line_user_id: 'line-1', actor_label: null, actor: null,
    },
    {
      id: 'log-2', entry_type: 'timeline', action: 'รับเรื่องแล้ว มอบหมายผู้รับผิดชอบ',
      detail: 'มอบหมายคุณวีระ ทีม IT Support · SLA ตอบรับ 1 ชม.', status_from: 'ใหม่', status_to: 'รับเรื่องแล้ว',
      created_at: '2026-08-29T02:20:00.000Z', actor_line_user_id: null, actor_label: null, actor: { full_name: 'วีระ ทองดี' },
    },
    {
      id: 'log-3', entry_type: 'timeline', action: 'ช่างเข้าตรวจสอบหน้างาน',
      detail: 'ตรวจ RAM และจอแสดงผล พบสายจอหลวม กำลังเปลี่ยนสายชุดใหม่', status_from: 'รับเรื่องแล้ว', status_to: 'กำลังดำเนินการ',
      created_at: '2026-08-29T06:40:00.000Z', actor_line_user_id: null, actor_label: null, actor: { full_name: 'วีระ ทองดี' },
    },
    {
      id: 'log-4', entry_type: 'comment', action: 'ข้อความสนทนา',
      detail: 'ขออนุญาตนำเครื่องไปเปลี่ยนสายจอที่ศูนย์บริการ คาดว่าจะคืนเครื่องได้ภายในวันนี้ครับ',
      status_from: null, status_to: null, created_at: '2026-08-29T06:45:00.000Z',
      actor_line_user_id: null, actor_label: null, actor: { full_name: 'วีระ ทองดี' },
    },
    {
      id: 'log-5', entry_type: 'comment', action: 'ข้อความสนทนา', detail: 'รับทราบครับ ขอบคุณครับ',
      status_from: null, status_to: null, created_at: '2026-08-29T06:50:00.000Z',
      actor_line_user_id: 'line-1', actor_label: null, actor: null,
    },
  ],
  attachments: [
    { id: 'file-1', original_filename: 'หน้าจอดำ.jpg', mime_type: 'image/jpeg', size_bytes: 220_154, created_at: '2026-08-29T02:12:00.000Z', signed_url: 'about:blank' },
  ],
};

const NOTIFICATIONS = [
  {
    id: 'note-1', ticket_id: 'ticket-awaiting', ticket_no: 'TK-2608-0121', ticket_title: 'ระบบ ERP เข้าใช้งานไม่ได้',
    action: 'บันทึกการดำเนินงาน', detail: 'ทีม IT แจ้งว่าดำเนินการเสร็จสิ้น รอท่านยืนยันปิดงานและประเมินการบริการ',
    status_to: 'เสร็จสิ้น', created_at: '2026-08-29T07:00:00.000Z',
  },
  {
    id: 'note-2', ticket_id: 'ticket-open', ticket_no: 'TK-2608-0142', ticket_title: 'โน้ตบุ๊กเปิดไม่ติด หน้าจอดำ',
    action: 'ข้อความสนทนา', detail: 'คุณวีระ ตอบกลับข้อความในการแจ้งซ่อมของท่าน',
    status_to: null, created_at: '2026-08-29T06:45:00.000Z',
  },
];

const CATEGORIES = [
  { id: 'cat-1', name: 'คอมพิวเตอร์ / โน้ตบุ๊ก', default_priority: 'ปานกลาง', response_sla_hours: 4, resolution_sla_hours: 24, sla_hours: 24 },
  { id: 'cat-2', name: 'อีเมล / บัญชีผู้ใช้', default_priority: 'ปานกลาง', response_sla_hours: 2, resolution_sla_hours: 8, sla_hours: 8 },
  { id: 'cat-3', name: 'ระบบ ERP', default_priority: 'สูง', response_sla_hours: 1, resolution_sla_hours: 4, sla_hours: 4 },
];

async function mockLineApi(page: Page) {
  await page.route(/\/api\/v1\/line\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = (data: unknown) => JSON.stringify({ success: true, data, requestId: 'line-portal-e2e' });

    if (path.endsWith('/bootstrap')) {
      await route.fulfill({ contentType: 'application/json', body: body({ configured: true, enabled: true, message: '', authenticated: true, profile: PROFILE }) });
      return;
    }
    if (path.endsWith('/notifications')) {
      await route.fulfill({ contentType: 'application/json', body: body(NOTIFICATIONS) });
      return;
    }
    if (path.endsWith('/ticket-categories')) {
      await route.fulfill({ contentType: 'application/json', body: body(CATEGORIES) });
      return;
    }
    if (path.endsWith('/tickets/ticket-open')) {
      await route.fulfill({ contentType: 'application/json', body: body(DETAIL) });
      return;
    }
    if (path.endsWith('/tickets')) {
      await route.fulfill({ contentType: 'application/json', body: body(TICKETS) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: body({}) });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

test.describe('LINE service desk portal', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await mockLineApi(page);
    await page.addInitScript(() => localStorage.setItem('line_session_token', 'a'.repeat(64)));
  });

  test('หน้าแรกแสดงสรุปสถานะและงานที่ต้องติดตาม', async ({ page }, testInfo) => {
    await page.goto('/line');

    await expect(page.getByRole('heading', { name: 'สวัสดี คุณนิธิธร ชูเกียรติ' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'แจ้งซ่อม / เปิด Ticket ใหม่' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'กำลังดำเนินการ 1 รายการ' })).toBeVisible();
    await expect(page.getByText('TK-2608-0121')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.screenshot({ path: testInfo.outputPath('line-portal-home.png'), fullPage: true });
  });

  test('เปิดรายละเอียด Ticket พร้อมไทม์ไลน์และกล่องข้อความ', async ({ page }, testInfo) => {
    await page.goto('/line');
    await page.getByText('โน้ตบุ๊กเปิดไม่ติด หน้าจอดำ').click();

    await expect(page.getByRole('heading', { name: 'โน้ตบุ๊กเปิดไม่ติด หน้าจอดำ' })).toBeVisible();
    await expect(page.getByText('ขั้นที่ 3 จาก 5 · กำลังแก้ไข')).toBeVisible();
    await expect(page.getByText('ช่างเข้าตรวจสอบหน้างาน')).toBeVisible();
    await expect(page.getByText('รับทราบครับ ขอบคุณครับ')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.screenshot({ path: testInfo.outputPath('line-portal-detail.png'), fullPage: true });
  });

  test('แท็บงานของฉัน แจ้งเตือน และโปรไฟล์เปิดได้ครบ', async ({ page }, testInfo) => {
    await page.goto('/line');

    await page.getByRole('button', { name: 'งานของฉัน' }).click();
    await expect(page.getByText('แสดง 3 รายการ · เรียงจากใหม่ไปเก่า')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('line-portal-tickets.png'), fullPage: true });

    await page.getByRole('button', { name: 'แจ้งเตือน' }).click();
    await expect(page.getByText('ทีม IT แจ้งว่าดำเนินการเสร็จสิ้น รอท่านยืนยันปิดงานและประเมินการบริการ')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('line-portal-notifications.png'), fullPage: true });

    await page.getByRole('button', { name: 'โปรไฟล์' }).click();
    await expect(page.getByText('ฝ่ายบัญชีและการเงิน · LINE: Nitithorn')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('line-portal-profile.png'), fullPage: true });

    await expectNoHorizontalOverflow(page);
  });

  test('ฟอร์มแจ้งซ่อมใหม่แสดงหมวดหมู่ ความเร่งด่วน และไฟล์แนบ', async ({ page }, testInfo) => {
    await page.goto('/line');
    await page.getByRole('button', { name: 'แจ้งซ่อม / เปิด Ticket ใหม่' }).click();

    await expect(page.getByLabel('หัวข้ออาการ')).toBeVisible();
    await page.getByRole('button', { name: 'ระบบ ERP' }).click();
    await expect(page.getByText('ทีม IT จะตอบรับภายใน 1 ชม. ตาม SLA ของหมวดหมู่นี้')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ส่ง Ticket' })).toBeDisabled();
    await expectNoHorizontalOverflow(page);

    await page.screenshot({ path: testInfo.outputPath('line-portal-new-ticket.png'), fullPage: true });
  });
});
