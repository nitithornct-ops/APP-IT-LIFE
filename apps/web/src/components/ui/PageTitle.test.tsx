import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PageTitle } from './PageTitle';

/**
 * หน้าที่ตั้งใจไม่ใช้ PageTitle พร้อมเหตุผล — ถ้าจะเพิ่มรายชื่อที่นี่ต้องเขียนเหตุผลกำกับเสมอ
 * เพราะทุกครั้งที่มีหน้าหลุดออกไป ระบบก็กลับไปมีหัวข้อคนละขนาดอีกแบบเดิม
 */
const INTENTIONALLY_WITHOUT_PAGE_TITLE: Record<string, string> = {
  'components/AppErrorBoundary.tsx': 'จอสำรองตอน render ล้ม ต้องไม่พึ่ง component อื่นที่อาจล้มตาม',
  'pages/HomePage.tsx': 'design handoff 4b กำหนดพาดหัวเล่าเรื่อง 40px/800 เป็นการเฉพาะ',
  'pages/WarRoomPage.tsx': 'design handoff 4a มีหัวจอ 60px ของตัวเองสำหรับดูจากระยะ 3 เมตร',
  'pages/HealthPage.tsx': 'ใช้ได้ทั้งในและนอกโครงแอป (standalone) จึงมีหัวข้อของตัวเอง',
  'pages/LoginPage.tsx': 'หน้า auth อยู่นอก AppShell',
  'pages/MfaChallengePage.tsx': 'หน้า auth ขั้นที่สองอยู่นอก AppShell',
  'pages/ForgotPasswordPage.tsx': 'หน้า auth อยู่นอก AppShell',
  'pages/ResetPasswordPage.tsx': 'หน้า auth อยู่นอก AppShell',
  'pages/LinePortalPage.tsx': 'พอร์ทัลสาธารณะ design handoff 3a ใช้ top-nav คนละแบบ',
  'features/linePortal/LineHomeTab.tsx': 'จอย่อยของ LINE Portal ใช้โครงแอปมือถือ (hero + bottom-nav) ไม่ใช่ AppShell',
  'features/linePortal/LineMyTicketsTab.tsx': 'จอย่อยของ LINE Portal ใช้โครงแอปมือถือ (hero + bottom-nav) ไม่ใช่ AppShell',
  'features/linePortal/LineNotificationsTab.tsx': 'จอย่อยของ LINE Portal ใช้โครงแอปมือถือ (hero + bottom-nav) ไม่ใช่ AppShell',
  'features/linePortal/LineTicketDetail.tsx': 'จอย่อยของ LINE Portal ใช้โครงแอปมือถือ (hero + bottom-nav) ไม่ใช่ AppShell',
  'pages/PublicTicketPortalPage.tsx': 'พอร์ทัลสาธารณะ design handoff 3a ใช้ top-nav คนละแบบ',
  'pages/VendorFormPortalPage.tsx': 'ฟอร์มสาธารณะสำหรับผู้ให้บริการ อยู่นอก AppShell',
  'pages/VendorPortalPage.tsx': 'พอร์ทัลบริษัทภายนอกใช้ session แยกและอยู่นอก AppShell',
  'pages/ProfilePage.tsx': 'design handoff 3h ใช้การ์ดโปรไฟล์พื้นเข้มแทนหัวข้อปกติ',
  'features/tickets/TicketFormPage.tsx': 'หน้าสำหรับสั่งพิมพ์ ใช้พื้นขาวขนาด A4 เสมอ',
};

const SRC = join(__dirname, '..', '..');

function collectTsx(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTsx(full, acc);
    else if (entry.endsWith('.tsx') && !entry.includes('.test.')) acc.push(full);
  }
  return acc;
}

afterEach(cleanup);

describe('PageTitle', () => {
  it('แสดงบริบท ชื่อหน้า คำอธิบาย และ meta ครบในบล็อกเดียว', () => {
    render(
      <PageTitle
        eyebrow="ทรัพย์สินและโครงสร้างพื้นฐาน / CMDB"
        title="CMDB — Configuration Items"
        description="ทะเบียนโครงสร้าง IT เชิงบริการ"
        meta={<span>ล่าสุด 23 ส.ค.</span>}
      />,
    );

    const heading = screen.getByRole('heading', { level: 1, name: 'CMDB — Configuration Items' });
    expect(heading).toBeVisible();
    expect(screen.getByText('ทรัพย์สินและโครงสร้างพื้นฐาน / CMDB')).toBeVisible();
    expect(screen.getByText('ทะเบียนโครงสร้าง IT เชิงบริการ')).toBeVisible();
    expect(screen.getByText('ล่าสุด 23 ส.ค.')).toBeVisible();
  });

  it('ไม่กินที่เมื่อไม่ได้ส่ง meta มา', () => {
    render(<PageTitle eyebrow="กลุ่ม / เมนู" title="หัวข้อ" description="คำอธิบาย" />);
    expect(screen.queryByText('ล่าสุด 23 ส.ค.')).not.toBeInTheDocument();
  });
});

describe('ความสม่ำเสมอของหัวข้อหน้า', () => {
  it('ทุกหน้าที่มี <h1> ใช้ PageTitle หรือ PageHeader เว้นแต่มีเหตุผลกำกับไว้', () => {
    const offenders: string[] = [];

    for (const file of collectTsx(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/');
      if (rel.startsWith('components/ui/PageTitle') || rel.startsWith('components/ui/PageHeader')) continue;

      const source = readFileSync(file, 'utf8');
      if (!source.includes('<h1')) continue;
      if (source.includes('PageTitle') || source.includes('PageHeader')) continue;
      if (rel in INTENTIONALLY_WITHOUT_PAGE_TITLE) continue;

      offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  });

  it('รายชื่อยกเว้นไม่มีหน้าที่ถูกลบหรือเปลี่ยนไปใช้ PageTitle แล้วค้างอยู่', () => {
    const stale = Object.keys(INTENTIONALLY_WITHOUT_PAGE_TITLE).filter((rel) => {
      let source: string;
      try {
        source = readFileSync(join(SRC, rel), 'utf8');
      } catch {
        return true; // ไฟล์หายไปแล้ว
      }
      return source.includes('PageTitle') || source.includes('PageHeader');
    });

    expect(stale).toEqual([]);
  });
});
