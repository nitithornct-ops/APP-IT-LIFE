import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * ตัวสร้างภาพย่อของหน้า PDF ด้วย pdf.js
 *
 * โมดูลนี้ถูก import แบบ dynamic จากหน้าจอเท่านั้น เพราะ pdf.js เป็นไลบรารีก้อนใหญ่ที่ผู้ใช้
 * ควรดาวน์โหลดเฉพาะตอนเปิดหน้าเครื่องมือ PDF ไม่ใช่ตอนเข้าระบบ
 *
 * worker ถูก bundle เป็นไฟล์ในโดเมนเดียวกัน จึงผ่าน CSP `default-src 'self'` ของ public/_headers
 * โดยไม่ต้องผ่อน 'unsafe-eval' ให้ใคร (pdf.js เลิกใช้ eval ตั้งแต่รุ่น 6)
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface ThumbnailRenderer {
  /** วาดหน้าที่ระบุ (เริ่มจาก 0) เป็น data URL ของ PNG */
  render(pageIndex: number, cssWidth: number): Promise<string>;
  destroy(): void;
}

export async function createThumbnailRenderer(bytes: Uint8Array): Promise<ThumbnailRenderer> {
  // pdf.js ยึด ArrayBuffer ที่ได้รับไปเป็นของตัวเอง (detach) — ต้องส่งสำเนา ไม่งั้นไบต์ต้นฉบับ
  // ที่หน้าจอเก็บไว้สำหรับประกอบไฟล์ผลลัพธ์จะกลายเป็นความยาว 0
  const task = pdfjs.getDocument({ data: bytes.slice(), disableAutoFetch: true });
  const document = await task.promise;
  let destroyed = false;

  return {
    async render(pageIndex: number, cssWidth: number): Promise<string> {
      if (destroyed) throw new Error('ปิดเอกสารนี้ไปแล้ว');
      const page = await document.getPage(pageIndex + 1);
      try {
        const unscaled = page.getViewport({ scale: 1 });
        // วาดที่สองเท่าของขนาดที่แสดง ภาพย่อจึงคมบนจอความละเอียดสูง
        const viewport = page.getViewport({ scale: (cssWidth * 2) / unscaled.width });
        const canvas = window.document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('เบราว์เซอร์นี้ใช้ canvas ไม่ได้ จึงแสดงภาพย่อไม่ได้');
        await page.render({ canvas, viewport }).promise;
        return canvas.toDataURL('image/png');
      } finally {
        page.cleanup();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // ปิดที่ตัว loading task เพื่อให้ worker ถูกปิดไปด้วย ไม่ใช่แค่ปล่อยเอกสารทิ้ง
      void task.destroy();
    },
  };
}
