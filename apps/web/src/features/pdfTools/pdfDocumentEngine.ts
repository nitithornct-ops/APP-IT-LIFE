import { degrees, PDFDocument, type PDFImage, type PDFPage } from 'pdf-lib';

/**
 * ตรรกะจัดการไฟล์ PDF ทั้งหมดของ "เครื่องมือจัดการ PDF" — ทำงานบนหน่วยความจำล้วน ๆ
 *
 * เจตนาแยกไฟล์นี้ออกจากหน้าจอและออกจาก canvas ของเบราว์เซอร์ เพราะ pdf-lib ทำงานได้ทั้งใน
 * เบราว์เซอร์และ Node ไฟล์นี้จึงทดสอบได้จริงด้วย Vitest โดยไม่ต้อง mock DOM ส่วนงานที่ต้องใช้
 * เบราว์เซอร์จริง (ถอดรหัสรูปภาพ, วาดข้อความไทยเป็นภาพ, สั่งดาวน์โหลด) อยู่ใน pdfBrowser.ts
 *
 * ไฟล์ของผู้ใช้ไม่เคยถูกส่งขึ้น server — ทุกอย่างเกิดในเครื่องผู้ใช้ ซึ่งเป็นเหตุผลที่หน้านี้เปิดให้
 * ผู้ใช้ที่ล็อกอินแล้วทุกคนใช้ได้โดยไม่ผูกกับ permission ของโมดูลใด
 */

/** ขนาด A4 ในหน่วย point (72 dpi) */
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

export interface PdfSource {
  /** รหัสภายในหน้าจอ ไม่ผูกกับข้อมูลใน database */
  id: string;
  name: string;
  bytes: Uint8Array;
  pageCount: number;
}

export interface WorkPage {
  /** คีย์คงที่ของการ์ดหนึ่งใบบนหน้าจอ ต้องไม่เปลี่ยนเมื่อสลับลำดับ */
  id: string;
  sourceId: string;
  /** ลำดับหน้าในไฟล์ต้นทาง เริ่มจาก 0 */
  sourceIndex: number;
  /** องศาที่ผู้ใช้หมุนเพิ่มจากค่าเดิมของหน้า (ตามเข็มนาฬิกาแบบเดียวกับ /Rotate ทวีคูณของ 90) */
  rotation: number;
}

export type StampPosition = 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right';

export interface WatermarkSpec {
  /** ภาพ PNG ของข้อความลายน้ำ — วาดมาจาก canvas เพื่อให้รองรับภาษาไทยโดยไม่ต้องฝังฟอนต์ */
  pngBytes: Uint8Array;
  /** ความกว้างของลายน้ำเทียบกับความกว้างหน้าที่ผู้ใช้เห็น (0–1) */
  widthRatio: number;
  opacity: number;
  /** องศาทวนเข็มนาฬิกาที่ผู้ใช้เลือก นับจากแนวนอนของหน้าที่ผู้ใช้เห็น */
  angle: number;
}

export interface PageLabelSpec {
  /** ภาพ PNG ของข้อความประจำหน้า เรียงตามลำดับหน้าของเอกสารผลลัพธ์ ช่องว่างไว้ได้ถ้าหน้านั้นไม่ใส่ */
  pngBytesPerPage: readonly (Uint8Array | null)[];
  position: StampPosition;
  /** ความสูงของข้อความเป็น point */
  heightPt: number;
  marginPt: number;
}

export interface BuildOptions {
  watermark?: WatermarkSpec;
  pageLabel?: PageLabelSpec;
}

export interface SplitPart {
  label: string;
  /** ลำดับหน้าในเอกสารที่กำลังทำงานอยู่ เริ่มจาก 0 */
  indices: number[];
}

/** ปัดองศาให้เป็นทวีคูณของ 90 ในช่วง 0–270 ตามที่ /Rotate ของ PDF ยอมรับ */
export function normalizeAngle(angle: number): number {
  const wrapped = (Math.round(angle / 90) * 90) % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** ปัดองศาอิสระ (ลายน้ำเอียง 45°) ให้อยู่ในช่วง 0–359 */
export function wrapDegrees(angle: number): number {
  const wrapped = angle % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * ขนาดหน้าที่ผู้ใช้เห็นจริง — หน้าที่ /Rotate เป็น 90 หรือ 270 จะสลับด้านกว้างกับด้านสูง
 * ถ้าไม่คิดเรื่องนี้ ลายน้ำบนหน้าที่หมุนแล้วจะล้นออกนอกกระดาษ
 */
export function displaySize(width: number, height: number, rotation: number): { width: number; height: number } {
  return normalizeAngle(rotation) % 180 === 90 ? { width: height, height: width } : { width, height };
}

/**
 * แปลงพิกัดที่ผู้ใช้เห็น (นับจากมุมล่างซ้ายของหน้าหลังหมุนแล้ว) กลับเป็นพิกัดในกล่องเนื้อหาของ PDF
 *
 * /Rotate หมุน "ภาพที่แสดง" ตามเข็มนาฬิกา แต่ pdf-lib วาดลงบนพิกัดก่อนหมุน การวางเลขหน้าไว้
 * "ล่างขวา" จึงต้องแปลงพิกัดก่อน ไม่งั้นหน้าที่หมุน 90° จะได้เลขหน้าไปโผล่ที่ขอบอื่น
 */
export function toMediaPoint(
  width: number,
  height: number,
  rotation: number,
  displayX: number,
  displayY: number,
): { x: number; y: number } {
  switch (normalizeAngle(rotation)) {
    case 90:
      return { x: width - displayY, y: displayX };
    case 180:
      return { x: width - displayX, y: height - displayY };
    case 270:
      return { x: displayY, y: height - displayX };
    default:
      return { x: displayX, y: displayY };
  }
}

/**
 * จุดมุมล่างซ้ายที่ต้องส่งให้ drawImage เพื่อให้ "จุดกึ่งกลางของภาพ" ไปอยู่ที่พิกัดที่ต้องการ
 * pdf-lib หมุนภาพรอบมุมล่างซ้ายที่เราส่งไป ไม่ใช่รอบจุดกึ่งกลาง จึงต้องถอยจุดยึดกลับเอง
 */
export function anchorForCenter(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  angle: number,
): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return {
    x: centerX - (halfWidth * cos - halfHeight * sin),
    y: centerY - (halfWidth * sin + halfHeight * cos),
  };
}

/** อ่านจำนวนหน้าและตรวจว่าเปิดไฟล์ได้จริงก่อนเอาเข้าพื้นที่ทำงาน */
export async function readPdfSource(id: string, name: string, bytes: Uint8Array): Promise<PdfSource> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    throw new Error(`เปิดไฟล์ "${name}" ไม่ได้ — ไฟล์อาจเสียหายหรือไม่ใช่ PDF`);
  }
  const pageCount = document.getPageCount();
  if (pageCount === 0) throw new Error(`ไฟล์ "${name}" ไม่มีหน้าเอกสารอยู่ข้างใน`);
  return { id, name, bytes, pageCount };
}

/** สร้างการ์ดหน้าเอกสารครบทุกหน้าของไฟล์หนึ่ง */
export function createWorkPages(source: PdfSource, makeId: (index: number) => string): WorkPage[] {
  return Array.from({ length: source.pageCount }, (_unused, index) => ({
    id: makeId(index),
    sourceId: source.id,
    sourceIndex: index,
    rotation: 0,
  }));
}

/**
 * ประกอบ PDF ผลลัพธ์จากลำดับหน้าที่ผู้ใช้จัดไว้ — จุดรวมเดียวของทั้งการรวมไฟล์ แยกไฟล์
 * ลบหน้า สลับลำดับ และหมุนหน้า เพราะทุกคำสั่งเหล่านั้นคือ "รายการหน้า" ที่ต่างกันเท่านั้น
 */
export async function buildPdf(
  sources: readonly PdfSource[],
  pages: readonly WorkPage[],
  options: BuildOptions = {},
): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('ยังไม่มีหน้าเอกสารให้บันทึก');

  const output = await PDFDocument.create();

  /**
   * คัดลอกทีเดียวต่อหนึ่งไฟล์ต้นทาง ไม่ใช่ทีละหน้า — copyPages แต่ละครั้งจะคัดลอกทรัพยากรร่วม
   * (ฟอนต์, รูป) ซ้ำใหม่ ไฟล์ผลลัพธ์จะบวมขึ้นมากถ้าเรียกทีละหน้า
   * เก็บเป็นคิวเพื่อให้หน้าเดิมที่ถูกใส่ซ้ำหลายครั้งได้สำเนาคนละชุด
   */
  const queues = new Map<string, PDFPage[]>();
  const cursors = new Map<string, number>();
  for (const source of sources) {
    const indices = pages.filter((page) => page.sourceId === source.id).map((page) => page.sourceIndex);
    if (indices.length === 0) continue;
    const loaded = await PDFDocument.load(source.bytes, { ignoreEncryption: true });
    queues.set(source.id, await output.copyPages(loaded, indices));
    cursors.set(source.id, 0);
  }

  for (const page of pages) {
    const queue = queues.get(page.sourceId);
    const cursor = cursors.get(page.sourceId) ?? 0;
    const copied = queue?.[cursor];
    if (!copied) throw new Error('ไม่พบไฟล์ต้นทางของหน้าที่เลือก กรุณาเพิ่มไฟล์ใหม่อีกครั้ง');
    cursors.set(page.sourceId, cursor + 1);
    copied.setRotation(degrees(normalizeAngle(copied.getRotation().angle + page.rotation)));
    output.addPage(copied);
  }

  const built = output.getPages();

  if (options.watermark) {
    const image = await output.embedPng(options.watermark.pngBytes);
    for (const page of built) drawWatermark(page, image, options.watermark);
  }

  if (options.pageLabel) {
    const spec = options.pageLabel;
    for (let index = 0; index < built.length; index += 1) {
      const bytes = spec.pngBytesPerPage[index];
      if (!bytes) continue;
      drawPageLabel(built[index], await output.embedPng(bytes), spec);
    }
  }

  return output.save();
}

function drawWatermark(page: PDFPage, image: PDFImage, spec: WatermarkSpec) {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const rotation = normalizeAngle(page.getRotation().angle);
  const view = displaySize(pageWidth, pageHeight, rotation);
  const width = view.width * spec.widthRatio;
  const height = (width * image.height) / image.width;
  const center = toMediaPoint(pageWidth, pageHeight, rotation, view.width / 2, view.height / 2);
  // หักล้าง /Rotate ของหน้าก่อน แล้วค่อยบวกมุมเอียงที่ผู้ใช้เลือก ลายน้ำจึงเอียงเท่ากันทุกหน้า
  const angle = wrapDegrees(rotation + spec.angle);
  const anchor = anchorForCenter(center.x, center.y, width, height, angle);
  page.drawImage(image, { x: anchor.x, y: anchor.y, width, height, rotate: degrees(angle), opacity: spec.opacity });
}

function drawPageLabel(page: PDFPage, image: PDFImage, spec: PageLabelSpec) {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const rotation = normalizeAngle(page.getRotation().angle);
  const view = displaySize(pageWidth, pageHeight, rotation);
  const height = spec.heightPt;
  const width = (height * image.width) / image.height;
  const spot = labelCenter(spec.position, view, width, height, spec.marginPt);
  const center = toMediaPoint(pageWidth, pageHeight, rotation, spot.x, spot.y);
  const anchor = anchorForCenter(center.x, center.y, width, height, rotation);
  page.drawImage(image, { x: anchor.x, y: anchor.y, width, height, rotate: degrees(rotation) });
}

/** จุดกึ่งกลางของข้อความประจำหน้าในพิกัดที่ผู้ใช้เห็น */
export function labelCenter(
  position: StampPosition,
  view: { width: number; height: number },
  width: number,
  height: number,
  margin: number,
): { x: number; y: number } {
  const bottom = margin + height / 2;
  const top = view.height - margin - height / 2;
  const left = margin + width / 2;
  const right = view.width - margin - width / 2;
  switch (position) {
    case 'bottom-left':
      return { x: left, y: bottom };
    case 'bottom-right':
      return { x: right, y: bottom };
    case 'top-center':
      return { x: view.width / 2, y: top };
    case 'top-right':
      return { x: right, y: top };
    default:
      return { x: view.width / 2, y: bottom };
  }
}

export type ImagePageLayout = 'a4' | 'image';

/**
 * แปลงรูปหนึ่งใบเป็น PDF หนึ่งหน้า เพื่อให้รูปกับ PDF อยู่ในพื้นที่ทำงานเดียวกันได้
 * รับเฉพาะ PNG เพราะฝั่งเบราว์เซอร์แปลงทุกนามสกุลเป็น PNG ให้แล้ว (รวม webp/gif ที่ pdf-lib ฝังตรงไม่ได้)
 */
export async function imageToPdfBytes(pngBytes: Uint8Array, layout: ImagePageLayout = 'a4'): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const image = await document.embedPng(pngBytes);

  if (layout === 'image') {
    const page = document.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    return document.save();
  }

  const landscape = image.width > image.height;
  const pageWidth = landscape ? A4_HEIGHT_PT : A4_WIDTH_PT;
  const pageHeight = landscape ? A4_WIDTH_PT : A4_HEIGHT_PT;
  const margin = 24;
  const scale = Math.min((pageWidth - margin * 2) / image.width, (pageHeight - margin * 2) / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const page = document.addPage([pageWidth, pageHeight]);
  page.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
  return document.save();
}

/** แปลง "1-3" หรือ "5" หนึ่งช่วงเป็นลำดับหน้าเริ่มจาก 0 */
function parseRangeToken(token: string, totalPages: number): number[] {
  const match = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(token);
  if (!match) throw new Error(`อ่านช่วงหน้า "${token}" ไม่ได้ — ใช้รูปแบบ 1-3 หรือ 5`);
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  if (start < 1 || end < 1) throw new Error('เลขหน้าต้องเริ่มจาก 1');
  if (start > end) throw new Error(`ช่วงหน้า "${token}" มีหน้าเริ่มต้นมากกว่าหน้าสุดท้าย`);
  if (end > totalPages) throw new Error(`เอกสารมี ${totalPages} หน้า จึงไม่มีหน้า ${end}`);
  return Array.from({ length: end - start + 1 }, (_unused, offset) => start - 1 + offset);
}

/** แปลงข้อความช่วงหน้าทั้งบรรทัด เช่น "1-3, 5, 8-10" เป็นลำดับหน้าชุดเดียว */
export function parsePageRanges(input: string, totalPages: number): number[] {
  const tokens = input
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) throw new Error('ระบุช่วงหน้าอย่างน้อยหนึ่งช่วง เช่น 1-3, 5');
  return tokens.flatMap((token) => parseRangeToken(token, totalPages));
}

/** แผนการแยกไฟล์แบบ "ทุก ๆ N หน้า" */
export function planSplitEveryN(totalPages: number, size: number): SplitPart[] {
  if (!Number.isInteger(size) || size < 1) throw new Error('จำนวนหน้าต่อไฟล์ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
  if (totalPages < 1) throw new Error('ยังไม่มีหน้าเอกสารให้แยก');
  const parts: SplitPart[] = [];
  for (let start = 0; start < totalPages; start += size) {
    const indices = Array.from({ length: Math.min(size, totalPages - start) }, (_unused, offset) => start + offset);
    const first = indices[0] + 1;
    const last = indices[indices.length - 1] + 1;
    parts.push({ label: first === last ? `หน้า ${first}` : `หน้า ${first}-${last}`, indices });
  }
  return parts;
}

/** แผนการแยกไฟล์แบบกำหนดช่วงเอง — หนึ่งช่วงที่คั่นด้วยจุลภาคคือหนึ่งไฟล์ */
export function planSplitByRanges(input: string, totalPages: number): SplitPart[] {
  const tokens = input
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) throw new Error('ระบุช่วงหน้าอย่างน้อยหนึ่งช่วง เช่น 1-3, 5');
  return tokens.map((token) => ({ label: `หน้า ${token}`, indices: parseRangeToken(token, totalPages) }));
}

/** ตั้งชื่อไฟล์ผลลัพธ์จากชื่อไฟล์ต้นทาง โดยตัดนามสกุลเดิมและอักขระที่ใช้ในชื่อไฟล์ไม่ได้ออก */
export function outputFileName(base: string, suffix: string): string {
  const withoutExtension = base.replace(/\.pdf$/i, '').trim();
  const safe = (withoutExtension || 'document').replace(/[\\/:*?"<>|]+/g, '-');
  return `${safe}-${suffix}.pdf`;
}
