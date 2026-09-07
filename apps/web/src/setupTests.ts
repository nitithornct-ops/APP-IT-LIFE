import '@testing-library/jest-dom/vitest';

// jsdom ไม่มี matchMedia ให้ ทำให้ ThemeProvider พังทันทีที่ถูก mount ในเทสต์
// สตับนี้ตอบว่า "ไม่ได้ชอบโหมดมืด" เสมอ เทสต์จึงเริ่มที่โหมดสว่างเหมือนกันทุกครั้ง
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// jsdom 25 ยังไม่มี Blob.arrayBuffer ทั้งที่เบราว์เซอร์ทุกตัวมีมาตั้งแต่ปี 2019
// โค้ดที่อ่านไฟล์ที่ผู้ใช้เลือก (เครื่องมือจัดการ PDF) จึงพังเฉพาะในเทสต์ ไม่ใช่ในของจริง
// อ่านผ่าน FileReader ซึ่ง jsdom รองรับ เพื่อให้ผลลัพธ์เหมือนของเบราว์เซอร์
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function readAsArrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error('อ่านไฟล์ไม่สำเร็จ'));
      reader.readAsArrayBuffer(this);
    });
  };
}
