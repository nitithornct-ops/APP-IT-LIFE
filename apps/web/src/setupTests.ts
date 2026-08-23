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
