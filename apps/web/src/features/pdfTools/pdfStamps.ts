import type { BuildOptions, StampPosition } from './pdfDocumentEngine';
import { renderTextStamp, waitForFonts } from './pdfBrowser';

/**
 * แปลงค่าที่ผู้ใช้ตั้งบนหน้าจอ (ลายน้ำและเลขหน้า) เป็นตัวเลือกที่ buildPdf เข้าใจ
 * ข้อความถูกวาดเป็นภาพที่นี่ครั้งเดียว แล้วส่งต่อให้ตัวประกอบ PDF นำไปวางทุกหน้า
 */

export type PageLabelFormat = 'number' | 'number_of_total' | 'thai';

export interface WatermarkSettings {
  enabled: boolean;
  text: string;
  /** ความกว้างของลายน้ำเทียบกับความกว้างหน้า (%) */
  sizePercent: number;
  opacityPercent: number;
  angle: number;
  color: string;
  bold: boolean;
}

export interface PageLabelSettings {
  enabled: boolean;
  format: PageLabelFormat;
  position: StampPosition;
  startNumber: number;
  fontSizePt: number;
  color: string;
}

/** ขนาดตัวอักษรบน canvas ของลายน้ำ — ความคมชัดเท่านั้น ขนาดจริงบนหน้ากระดาษมาจาก sizePercent */
const WATERMARK_CANVAS_FONT_PX = 64;

/** ภาพข้อความเผื่อขอบบน-ล่างรวมเป็น 1.6 เท่าของขนาดตัวอักษร ต้องคูณกลับตอนกำหนดความสูงบนหน้ากระดาษ */
const LABEL_BOX_RATIO = 1.6;

/** ระยะห่างจากขอบกระดาษของเลขหน้า (point) */
const LABEL_MARGIN_PT = 24;

export const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: false,
  text: 'สำเนา',
  sizePercent: 55,
  opacityPercent: 18,
  angle: 45,
  color: '#dc2626',
  bold: true,
};

export const DEFAULT_PAGE_LABEL: PageLabelSettings = {
  enabled: false,
  format: 'number_of_total',
  position: 'bottom-center',
  startNumber: 1,
  fontSizePt: 11,
  color: '#334155',
};

export function formatPageLabel(format: PageLabelFormat, current: number, total: number): string {
  switch (format) {
    case 'number':
      return String(current);
    case 'thai':
      return `หน้า ${current} จาก ${total}`;
    default:
      return `${current} / ${total}`;
  }
}

/** ตัวอย่างข้อความเลขหน้าที่จะได้ ใช้โชว์ให้ผู้ใช้เห็นก่อนกดบันทึก */
export function previewPageLabel(settings: PageLabelSettings, pageCount: number): string {
  const total = settings.startNumber + Math.max(pageCount, 1) - 1;
  return formatPageLabel(settings.format, settings.startNumber, total);
}

export async function buildStampOptions(
  watermark: WatermarkSettings,
  pageLabel: PageLabelSettings,
  pageCount: number,
): Promise<BuildOptions> {
  const options: BuildOptions = {};
  const wantsWatermark = watermark.enabled && watermark.text.trim().length > 0;
  if (!wantsWatermark && !pageLabel.enabled) return options;

  await waitForFonts();

  if (wantsWatermark) {
    options.watermark = {
      pngBytes: await renderTextStamp(watermark.text, {
        fontSize: WATERMARK_CANVAS_FONT_PX,
        color: watermark.color,
        bold: watermark.bold,
      }),
      widthRatio: watermark.sizePercent / 100,
      opacity: watermark.opacityPercent / 100,
      angle: watermark.angle,
    };
  }

  if (pageLabel.enabled) {
    const total = pageLabel.startNumber + pageCount - 1;
    const pngBytesPerPage: Uint8Array[] = [];
    for (let index = 0; index < pageCount; index += 1) {
      pngBytesPerPage.push(
        await renderTextStamp(formatPageLabel(pageLabel.format, pageLabel.startNumber + index, total), {
          fontSize: pageLabel.fontSizePt,
          color: pageLabel.color,
          bold: false,
        }),
      );
    }
    options.pageLabel = {
      pngBytesPerPage,
      position: pageLabel.position,
      heightPt: pageLabel.fontSizePt * LABEL_BOX_RATIO,
      marginPt: LABEL_MARGIN_PT,
    };
  }

  return options;
}
