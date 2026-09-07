import { describe, expect, it } from 'vitest';
import { effectiveMarginMm, PAGE_BREAK_HTML, pageGeometry, paginateElement } from './formPagination';

/**
 * jsdom ไม่คำนวณ layout ความสูงจึงเป็น 0 เสมอ เทสต์ชุดนี้จึงป้อนความสูงเองผ่าน data-h
 * ทำให้ตรวจ "ตรรกะการจัดหน้า" ได้ตรง ๆ โดยไม่ต้องเปิดเบราว์เซอร์จริง
 */
function measureHeight(element: HTMLElement): number {
  return Number(element.dataset.h ?? element.getAttribute('data-h') ?? 0);
}

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

function paginate(html: string, pageHeightPx: number) {
  return paginateElement(mount(html), { pageHeightPx, measureHeight }).pages;
}

describe('paginateElement', () => {
  it('เก็บทุก block ไว้หน้าเดียวเมื่อความสูงรวมยังไม่เกินหนึ่งหน้า', () => {
    const pages = paginate('<p data-h="30">ก</p><p data-h="30">ข</p>', 100);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('ก');
    expect(pages[0]).toContain('ข');
  });

  it('ขึ้นหน้าใหม่เมื่อ block ถัดไปไม่พอดีกับที่เหลือ', () => {
    const pages = paginate('<p data-h="60">ก</p><p data-h="60">ข</p><p data-h="20">ค</p>', 100);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('ก');
    expect(pages[1]).toContain('ข');
    expect(pages[1]).toContain('ค');
  });

  it('ขึ้นหน้าใหม่ตรงตัวแบ่งหน้าที่ผู้ใช้สั่งไว้ แม้หน้ายังว่างอยู่มาก', () => {
    const pages = paginate(`<p data-h="10">ก</p>${PAGE_BREAK_HTML}<p data-h="10">ข</p>`, 500);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('ก');
    expect(pages[1]).toContain('ข');
  });

  it('ไม่สร้างหน้าว่างจากตัวแบ่งหน้าที่อยู่ต้นเอกสารหรือวางซ้อนกัน', () => {
    const pages = paginate(`${PAGE_BREAK_HTML}${PAGE_BREAK_HTML}<p data-h="10">ก</p>${PAGE_BREAK_HTML}`, 500);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('ก');
  });

  it('ไม่ทิ้งร่องรอยของตัวแบ่งหน้าไว้ในผลลัพธ์', () => {
    const pages = paginate(`<p data-h="10">ก</p>${PAGE_BREAK_HTML}<p data-h="10">ข</p>`, 500);
    expect(pages.join('')).not.toContain('form-page-break');
  });

  it('ตัดตารางยาวตามแถว และคัดลอกหัวตารางไปทุกหน้า', () => {
    const rows = ['หนึ่ง', 'สอง', 'สาม', 'สี่']
      .map((label) => `<tr data-h="40"><td>${label}</td></tr>`)
      .join('');
    const pages = paginate(
      `<table data-h="200"><thead data-h="20"><tr><th>คอลัมน์</th></tr></thead><tbody>${rows}</tbody></table>`,
      100,
    );

    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(page).toContain('คอลัมน์');
    const joined = pages.join('');
    for (const label of ['หนึ่ง', 'สอง', 'สาม', 'สี่']) expect(joined).toContain(label);
  });

  it('ไม่ทำแถวหายและไม่ทำแถวซ้ำตอนตัดตาราง', () => {
    const rows = Array.from({ length: 9 }, (_unused, index) => `<tr data-h="30"><td>แถว${index + 1}</td></tr>`).join('');
    const pages = paginate(`<table data-h="270"><tbody>${rows}</tbody></table>`, 100);
    const joined = pages.join('');
    for (let index = 1; index <= 9; index += 1) {
      expect(joined.split(`แถว${index}<`).length - 1, `แถว${index} ต้องปรากฏครั้งเดียว`).toBe(1);
    }
  });

  it('ย้ายตารางไปเริ่มหน้าใหม่เมื่อที่เหลือไม่พอวางหัวตารางกับแถวแรก', () => {
    const rows = ['หนึ่ง', 'สอง', 'สาม']
      .map((label) => `<tr data-h="30"><td>${label}</td></tr>`)
      .join('');
    const pages = paginate(
      `<p data-h="95">ข้อความนำ</p><table data-h="110"><thead data-h="20"><tr><th>คอลัมน์</th></tr></thead><tbody>${rows}</tbody></table>`,
      100,
    );
    expect(pages[0]).toContain('ข้อความนำ');
    expect(pages[0]).not.toContain('หนึ่ง');
    expect(pages[1]).toContain('หนึ่ง');
  });

  it('วาง block เดี่ยวที่สูงเกินหนึ่งหน้าไว้บนหน้าของตัวเองแทนที่จะวนไม่รู้จบ', () => {
    const pages = paginate('<p data-h="10">ก</p><p data-h="900">รูปใหญ่</p><p data-h="10">ข</p>', 100);
    expect(pages).toHaveLength(3);
    expect(pages[1]).toContain('รูปใหญ่');
  });

  it('คืนหน้าเดียวเมื่อยังไม่รู้ความสูงของกระดาษ', () => {
    const pages = paginate('<p data-h="30">ก</p>', 0);
    expect(pages).toHaveLength(1);
  });

  it('คืนรายการว่างเมื่อไม่มีเนื้อหา', () => {
    expect(paginate('', 100)).toHaveLength(0);
  });
});

describe('pageGeometry', () => {
  it('คำนวณพื้นที่เนื้อหาของ A4 แนวตั้งตามขอบกระดาษที่ตั้งไว้', () => {
    const geometry = pageGeometry('A4', 'portrait', 20);
    expect(Math.round(geometry.widthPx)).toBe(794);
    expect(Math.round(geometry.heightPx)).toBe(1123);
    expect(Math.round(geometry.contentWidthPx)).toBe(643);
    expect(Math.round(geometry.contentHeightPx)).toBe(971);
  });

  it('สลับด้านกว้างกับด้านสูงเมื่อเป็นแนวนอน', () => {
    const portrait = pageGeometry('A4', 'portrait', 20);
    const landscape = pageGeometry('A4', 'landscape', 20);
    expect(Math.round(landscape.widthPx)).toBe(Math.round(portrait.heightPx));
    expect(Math.round(landscape.heightPx)).toBe(Math.round(portrait.widthPx));
  });

  it('รองรับกระดาษ Letter ตามที่ Form Studio ตั้งได้', () => {
    expect(Math.round(pageGeometry('Letter', 'portrait', 20).widthPx)).toBe(816);
  });
});

describe('effectiveMarginMm', () => {
  it('ใช้ขอบตามที่ Form Studio ตั้งไว้เมื่อกว้างพอสำหรับการพิมพ์', () => {
    expect(effectiveMarginMm(20)).toBe(20);
    expect(effectiveMarginMm(25)).toBe(25);
  });

  it('ไม่ยอมให้ขอบแคบกว่าขอบของ @page ไม่งั้นหน้าที่พอดีบนจอจะล้นตอนพิมพ์', () => {
    expect(effectiveMarginMm(5)).toBe(10);
  });

  it('ใช้ค่าเริ่มต้นเมื่อแม่แบบไม่ได้ตั้งขอบไว้', () => {
    expect(effectiveMarginMm(undefined)).toBe(20);
  });
});
