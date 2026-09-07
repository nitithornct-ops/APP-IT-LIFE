import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  anchorForCenter,
  buildPdf,
  createWorkPages,
  displaySize,
  imageToPdfBytes,
  labelCenter,
  normalizeAngle,
  outputFileName,
  parsePageRanges,
  planSplitByRanges,
  planSplitEveryN,
  readPdfSource,
  toMediaPoint,
  wrapDegrees,
  type WorkPage,
} from './pdfDocumentEngine';

/** PNG โปร่งใสขนาด 1x1 — เล็กที่สุดที่ pdf-lib ยังฝังได้จริง ใช้แทนภาพลายน้ำในเทสต์ */
const ONE_PIXEL_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
);

/** เอกสารทดสอบที่แต่ละหน้ากว้างไม่เท่ากัน จึงตรวจ "ลำดับหน้า" ของผลลัพธ์ได้จากความกว้าง */
async function samplePdf(pageCount: number, rotation = 0): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.addPage([100 + index * 10, 400]);
    if (rotation) page.setRotation(degrees(rotation));
  }
  return document.save();
}

async function widthsOf(bytes: Uint8Array): Promise<number[]> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => Math.round(page.getSize().width));
}

describe('normalizeAngle', () => {
  it('ปัดเป็นทวีคูณของ 90 ในช่วง 0–270', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(90)).toBe(90);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(450)).toBe(90);
  });

  it('แปลงองศาติดลบให้เป็นค่าบวกที่เทียบเท่ากัน', () => {
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(-450)).toBe(270);
  });
});

describe('wrapDegrees', () => {
  it('เก็บมุมอิสระของลายน้ำไว้ในช่วง 0–359 โดยไม่ปัดเป็นทวีคูณของ 90', () => {
    expect(wrapDegrees(45)).toBe(45);
    expect(wrapDegrees(405)).toBe(45);
    expect(wrapDegrees(-45)).toBe(315);
  });
});

describe('displaySize', () => {
  it('สลับด้านกว้างกับด้านสูงเมื่อหน้าถูกหมุน 90 หรือ 270 องศา', () => {
    expect(displaySize(200, 400, 0)).toEqual({ width: 200, height: 400 });
    expect(displaySize(200, 400, 90)).toEqual({ width: 400, height: 200 });
    expect(displaySize(200, 400, 180)).toEqual({ width: 200, height: 400 });
    expect(displaySize(200, 400, 270)).toEqual({ width: 400, height: 200 });
  });
});

describe('toMediaPoint', () => {
  it('ไม่แปลงอะไรเมื่อหน้าไม่ได้หมุน', () => {
    expect(toMediaPoint(200, 400, 0, 30, 40)).toEqual({ x: 30, y: 40 });
  });

  /**
   * มุมล่างซ้ายของ "หน้าที่ผู้ใช้เห็น" ต้องตกไปที่มุมของกล่องเนื้อหาจริงตามการหมุน
   * ถ้าคำนวณผิด เลขหน้าที่สั่งไว้ล่างซ้ายจะไปโผล่อีกมุมหนึ่งบนหน้าที่หมุนแล้ว
   */
  it('ย้ายมุมล่างซ้ายที่มองเห็นไปยังมุมที่ถูกต้องของกล่องเนื้อหา', () => {
    expect(toMediaPoint(200, 400, 90, 0, 0)).toEqual({ x: 200, y: 0 });
    expect(toMediaPoint(200, 400, 180, 0, 0)).toEqual({ x: 200, y: 400 });
    expect(toMediaPoint(200, 400, 270, 0, 0)).toEqual({ x: 0, y: 400 });
  });

  it('รักษาจุดกึ่งกลางหน้าไว้ที่เดิมทุกมุมการหมุน', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const view = displaySize(200, 400, rotation);
      expect(toMediaPoint(200, 400, rotation, view.width / 2, view.height / 2)).toEqual({ x: 100, y: 200 });
    }
  });
});

describe('anchorForCenter', () => {
  it('คืนมุมล่างซ้ายเมื่อไม่หมุน', () => {
    expect(anchorForCenter(100, 100, 40, 20, 0)).toEqual({ x: 80, y: 90 });
  });

  it('ทำให้จุดกึ่งกลางของภาพยังอยู่ที่เดิมเมื่อหมุน 90 องศา', () => {
    const anchor = anchorForCenter(100, 100, 40, 20, 90);
    // หมุนทวนเข็ม 90 องศารอบจุดยึด แล้วจุดกึ่งกลางต้องกลับมาที่ (100, 100)
    const radians = Math.PI / 2;
    const centerX = anchor.x + (20 * Math.cos(radians) - 10 * Math.sin(radians));
    const centerY = anchor.y + (20 * Math.sin(radians) + 10 * Math.cos(radians));
    expect(centerX).toBeCloseTo(100, 6);
    expect(centerY).toBeCloseTo(100, 6);
  });
});

describe('labelCenter', () => {
  it('วางเลขหน้าห่างจากขอบตามระยะที่กำหนดในทุกตำแหน่ง', () => {
    const view = { width: 600, height: 800 };
    expect(labelCenter('bottom-center', view, 40, 16, 24)).toEqual({ x: 300, y: 32 });
    expect(labelCenter('bottom-right', view, 40, 16, 24)).toEqual({ x: 556, y: 32 });
    expect(labelCenter('bottom-left', view, 40, 16, 24)).toEqual({ x: 44, y: 32 });
    expect(labelCenter('top-center', view, 40, 16, 24)).toEqual({ x: 300, y: 768 });
    expect(labelCenter('top-right', view, 40, 16, 24)).toEqual({ x: 556, y: 768 });
  });
});

describe('readPdfSource', () => {
  it('อ่านจำนวนหน้าจากไฟล์จริง', async () => {
    const source = await readPdfSource('s1', 'a.pdf', await samplePdf(3));
    expect(source.pageCount).toBe(3);
    expect(source.name).toBe('a.pdf');
  });

  it('บอกชื่อไฟล์ที่เปิดไม่ได้ในข้อความผิดพลาด', async () => {
    await expect(readPdfSource('s1', 'พัง.pdf', new Uint8Array([1, 2, 3]))).rejects.toThrow('พัง.pdf');
  });
});

describe('createWorkPages', () => {
  it('สร้างการ์ดครบทุกหน้าโดยยังไม่หมุน', async () => {
    const source = await readPdfSource('s1', 'a.pdf', await samplePdf(2));
    const pages = createWorkPages(source, (index) => `p${index}`);
    expect(pages).toEqual([
      { id: 'p0', sourceId: 's1', sourceIndex: 0, rotation: 0 },
      { id: 'p1', sourceId: 's1', sourceIndex: 1, rotation: 0 },
    ]);
  });
});

describe('buildPdf', () => {
  it('ปฏิเสธเมื่อไม่มีหน้าให้บันทึก', async () => {
    await expect(buildPdf([], [])).rejects.toThrow('ยังไม่มีหน้าเอกสารให้บันทึก');
  });

  it('รวมหลายไฟล์เป็นไฟล์เดียวตามลำดับที่ส่งเข้ามา', async () => {
    const first = await readPdfSource('s1', 'first.pdf', await samplePdf(2));
    const second = await readPdfSource('s2', 'second.pdf', await samplePdf(1));
    const pages: WorkPage[] = [
      { id: 'a', sourceId: 's2', sourceIndex: 0, rotation: 0 },
      { id: 'b', sourceId: 's1', sourceIndex: 1, rotation: 0 },
      { id: 'c', sourceId: 's1', sourceIndex: 0, rotation: 0 },
    ];
    // ไฟล์ทดสอบทุกไฟล์ใช้ความกว้างชุดเดียวกัน (100, 110) ลำดับที่ได้จึงอ่านจากความกว้างได้ตรง ๆ
    expect(await widthsOf(await buildPdf([first, second], pages))).toEqual([100, 110, 100]);
  });

  it('เก็บเฉพาะหน้าที่ส่งมา จึงเป็นทั้งการลบหน้าและการแยกไฟล์ในตัว', async () => {
    const source = await readPdfSource('s1', 'a.pdf', await samplePdf(4));
    const pages = createWorkPages(source, (index) => `p${index}`).filter((page) => page.sourceIndex !== 1);
    expect(await widthsOf(await buildPdf([source], pages))).toEqual([100, 120, 130]);
  });

  it('ใส่หน้าเดิมซ้ำได้เมื่อผู้ใช้สั่งทำสำเนา', async () => {
    const source = await readPdfSource('s1', 'a.pdf', await samplePdf(2));
    const pages: WorkPage[] = [
      { id: 'a', sourceId: 's1', sourceIndex: 0, rotation: 0 },
      { id: 'b', sourceId: 's1', sourceIndex: 0, rotation: 0 },
      { id: 'c', sourceId: 's1', sourceIndex: 1, rotation: 0 },
    ];
    expect(await widthsOf(await buildPdf([source], pages))).toEqual([100, 100, 110]);
  });

  it('บวกองศาที่ผู้ใช้หมุนเข้ากับองศาเดิมของหน้า', async () => {
    const source = await readPdfSource('s1', 'a.pdf', await samplePdf(2, 90));
    const pages: WorkPage[] = [
      { id: 'a', sourceId: 's1', sourceIndex: 0, rotation: 90 },
      { id: 'b', sourceId: 's1', sourceIndex: 1, rotation: 270 },
    ];
    const document = await PDFDocument.load(await buildPdf([source], pages));
    expect(document.getPages().map((page) => page.getRotation().angle)).toEqual([180, 0]);
  });

  it('บอกให้เพิ่มไฟล์ใหม่เมื่อหน้าอ้างถึงไฟล์ต้นทางที่ไม่มีอยู่', async () => {
    const source = await readPdfSource('s1', 'a.pdf', await samplePdf(1));
    const pages: WorkPage[] = [{ id: 'a', sourceId: 'หายไป', sourceIndex: 0, rotation: 0 }];
    await expect(buildPdf([source], pages)).rejects.toThrow('ไม่พบไฟล์ต้นทาง');
  });

  it('วางลายน้ำและเลขหน้าได้โดยไม่ทำให้จำนวนหน้าเปลี่ยน', async () => {
    const source = await readPdfSource('s1', 'a.pdf', await samplePdf(2));
    const pages = createWorkPages(source, (index) => `p${index}`);
    const bytes = await buildPdf([source], pages, {
      watermark: { pngBytes: ONE_PIXEL_PNG, widthRatio: 0.5, opacity: 0.2, angle: 45 },
      pageLabel: { pngBytesPerPage: [ONE_PIXEL_PNG, ONE_PIXEL_PNG], position: 'bottom-right', heightPt: 16, marginPt: 24 },
    });
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(2);
  });

  it('ข้ามหน้าที่ไม่มีภาพเลขหน้าแทนที่จะพัง', async () => {
    const source = await readPdfSource('s1', 'a.pdf', await samplePdf(2));
    const pages = createWorkPages(source, (index) => `p${index}`);
    const bytes = await buildPdf([source], pages, {
      pageLabel: { pngBytesPerPage: [null, ONE_PIXEL_PNG], position: 'bottom-center', heightPt: 16, marginPt: 24 },
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });
});

describe('imageToPdfBytes', () => {
  it('วางรูปลงหน้า A4 เมื่อเลือกแบบ a4', async () => {
    const document = await PDFDocument.load(await imageToPdfBytes(ONE_PIXEL_PNG, 'a4'));
    const size = document.getPage(0).getSize();
    expect(Math.round(size.width)).toBe(595);
    expect(Math.round(size.height)).toBe(842);
  });

  it('ใช้ขนาดของรูปเป็นขนาดหน้าเมื่อเลือกแบบ image', async () => {
    const document = await PDFDocument.load(await imageToPdfBytes(ONE_PIXEL_PNG, 'image'));
    expect(document.getPage(0).getSize()).toEqual({ width: 1, height: 1 });
  });
});

describe('parsePageRanges', () => {
  it('อ่านทั้งหน้าเดี่ยวและช่วงหน้าในบรรทัดเดียว', () => {
    expect(parsePageRanges('1-3, 5', 10)).toEqual([0, 1, 2, 4]);
    expect(parsePageRanges('  2 - 4 ', 10)).toEqual([1, 2, 3]);
  });

  it('ปฏิเสธช่วงที่เกินจำนวนหน้าจริง', () => {
    expect(() => parsePageRanges('1-11', 10)).toThrow('เอกสารมี 10 หน้า');
  });

  it('ปฏิเสธช่วงที่กลับหัวกลับหาง', () => {
    expect(() => parsePageRanges('5-2', 10)).toThrow('มีหน้าเริ่มต้นมากกว่าหน้าสุดท้าย');
  });

  it('ปฏิเสธข้อความที่ไม่ใช่ตัวเลข', () => {
    expect(() => parsePageRanges('หน้าแรก', 10)).toThrow('อ่านช่วงหน้า');
  });

  it('ปฏิเสธบรรทัดว่าง', () => {
    expect(() => parsePageRanges('   ', 10)).toThrow('ระบุช่วงหน้าอย่างน้อยหนึ่งช่วง');
  });
});

describe('planSplitEveryN', () => {
  it('แบ่งเท่า ๆ กันและเก็บเศษไว้ไฟล์สุดท้าย', () => {
    expect(planSplitEveryN(5, 2)).toEqual([
      { label: 'หน้า 1-2', indices: [0, 1] },
      { label: 'หน้า 3-4', indices: [2, 3] },
      { label: 'หน้า 5', indices: [4] },
    ]);
  });

  it('ปฏิเสธจำนวนหน้าต่อไฟล์ที่ไม่ใช่จำนวนเต็มบวก', () => {
    expect(() => planSplitEveryN(5, 0)).toThrow('จำนวนหน้าต่อไฟล์');
    expect(() => planSplitEveryN(5, 1.5)).toThrow('จำนวนหน้าต่อไฟล์');
  });
});

describe('planSplitByRanges', () => {
  it('ถือหนึ่งช่วงที่คั่นด้วยจุลภาคเป็นหนึ่งไฟล์', () => {
    expect(planSplitByRanges('1-2, 4', 5)).toEqual([
      { label: 'หน้า 1-2', indices: [0, 1] },
      { label: 'หน้า 4', indices: [3] },
    ]);
  });
});

describe('outputFileName', () => {
  it('ตัดนามสกุลเดิมแล้วต่อท้ายด้วยคำอธิบาย', () => {
    expect(outputFileName('รายงาน.pdf', 'แก้ไขแล้ว')).toBe('รายงาน-แก้ไขแล้ว.pdf');
  });

  it('แทนที่อักขระที่ใช้ในชื่อไฟล์บน Windows ไม่ได้', () => {
    expect(outputFileName('a/b:c*d.pdf', 'x')).toBe('a-b-c-d-x.pdf');
  });

  it('ใช้ชื่อสำรองเมื่อชื่อเดิมว่าง', () => {
    expect(outputFileName('  ', 'x')).toBe('document-x.pdf');
  });
});
