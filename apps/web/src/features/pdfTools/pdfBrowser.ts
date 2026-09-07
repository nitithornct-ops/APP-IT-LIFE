/**
 * ส่วนของ "เครื่องมือจัดการ PDF" ที่ต้องพึ่งเบราว์เซอร์จริง — อ่านไฟล์ ถอดรหัสรูปภาพ วาดข้อความ
 * เป็นภาพ และสั่งดาวน์โหลด แยกออกจาก pdfDocumentEngine.ts เพื่อให้ตรรกะ PDF ยังทดสอบใน Node ได้
 *
 * เหตุที่วาดข้อความลายน้ำ/เลขหน้าเป็นภาพแทนการฝังฟอนต์: ฟอนต์มาตรฐานของ PDF ไม่มีสระและวรรณยุกต์ไทย
 * ส่วนการฝังฟอนต์ไทยต้องแนบไฟล์ฟอนต์ลงใน bundle และ CSP ของระบบไม่อนุญาตให้ fetch ฟอนต์จาก
 * fonts.gstatic.com (อยู่ใน font-src แต่ไม่อยู่ใน connect-src) การให้เบราว์เซอร์วาดด้วยฟอนต์ที่หน้าจอ
 * ใช้อยู่แล้วจึงได้ทั้งภาษาไทยและทุกภาษาอื่นโดยไม่เพิ่มไฟล์ใด ๆ
 */

/** ฟอนต์เดียวกับที่หน้าจอใช้ เพื่อให้ลายน้ำหน้าตาตรงกับที่เห็นบนเว็บ */
const FONT_STACK = "'Sarabun', 'Segoe UI', 'Noto Sans Thai', sans-serif";

/** วาดที่ความละเอียด 3 เท่าแล้วย่อลงตอนฝังใน PDF ข้อความจึงไม่แตกเวลาพิมพ์ */
const STAMP_SUPERSAMPLE = 3;

/** ย่อรูปที่ใหญ่เกินจำเป็นก่อนฝัง เพื่อไม่ให้ไฟล์ผลลัพธ์บวมจนส่งอีเมลไม่ได้ */
const MAX_IMAGE_EDGE_PX = 2400;

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'] as const;

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name);
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('เบราว์เซอร์นี้ใช้ canvas ไม่ได้ จึงสร้างลายน้ำและแปลงรูปไม่ได้');
  return { canvas, context };
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('แปลงภาพเป็น PNG ไม่สำเร็จ');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * แปลงรูปทุกนามสกุลที่รับไว้ให้เป็น PNG ชุดเดียว — pdf-lib ฝังได้แค่ PNG กับ JPEG
 * และการผ่าน canvas ยังช่วยหมุนรูปตาม EXIF ให้ตรงกับที่ผู้ใช้เห็นในเครื่องด้วย
 */
export async function imageFileToPngBytes(file: File): Promise<Uint8Array> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`อ่านรูป "${file.name}" ไม่ได้ — ไฟล์อาจเสียหายหรือเบราว์เซอร์ไม่รองรับนามสกุลนี้`);
  }
  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const { canvas, context } = createCanvas(bitmap.width * scale, bitmap.height * scale);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvasToPngBytes(canvas);
  } finally {
    bitmap.close();
  }
}

export interface TextStampStyle {
  /** ขนาดตัวอักษรเป็น px บน canvas — สัดส่วนจริงบนหน้ากระดาษกำหนดตอนฝังใน PDF */
  fontSize: number;
  color: string;
  bold: boolean;
}

/** วาดข้อความหนึ่งบรรทัดลงภาพโปร่งใส คืนเป็น PNG พร้อมฝังลงหน้า PDF */
export async function renderTextStamp(text: string, style: TextStampStyle): Promise<Uint8Array> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('ยังไม่ได้พิมพ์ข้อความ');

  const fontSize = style.fontSize * STAMP_SUPERSAMPLE;
  const font = `${style.bold ? 700 : 400} ${fontSize}px ${FONT_STACK}`;

  const measurer = createCanvas(1, 1);
  measurer.context.font = font;
  const textWidth = measurer.context.measureText(trimmed).width;

  // เผื่อขอบให้สระบนและวรรณยุกต์ไทยไม่ถูกตัด — ตัวไทยกินพื้นที่แนวตั้งมากกว่าตัวละติน
  const { canvas, context } = createCanvas(textWidth + fontSize * 0.4, fontSize * 1.6);
  context.font = font;
  context.fillStyle = style.color;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(trimmed, canvas.width / 2, canvas.height / 2);
  return canvasToPngBytes(canvas);
}

/** รอให้ฟอนต์ที่หน้าจอใช้โหลดเสร็จก่อนวัดความกว้างข้อความ ไม่งั้นลายน้ำจะกว้างผิดตอนโหลดหน้าใหม่ ๆ */
export async function waitForFonts(): Promise<void> {
  try {
    await document.fonts?.ready;
  } catch {
    // ฟอนต์โหลดไม่เสร็จก็ยังวาดได้ด้วยฟอนต์สำรอง ไม่ต้องหยุดงานของผู้ใช้
  }
}

/**
 * สำเนาไบต์ลง ArrayBuffer ของตัวเอง — Uint8Array ที่ pdf-lib คืนมาอาจอิงบัฟเฟอร์ชนิดที่ Blob
 * ไม่รับตามนิยามของ TypeScript การคัดลอกทำให้ชนิดตรงโดยไม่ต้อง cast ทับความปลอดภัยของ type
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function downloadBytes(bytes: Uint8Array, fileName: string, mimeType = 'application/pdf'): void {
  const blob = new Blob([toArrayBuffer(bytes)], { type: mimeType });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
