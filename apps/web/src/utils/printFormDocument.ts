import { formDocumentHtml } from '@itlife/shared';
import { sanitizeFormHtml } from './formHtml';

/** Print in an isolated document so application layout and responsive CSS cannot alter the paper. */
export async function printFormDocument(html: string, title: string): Promise<void> {
  const frame = document.createElement('iframe');
  frame.title = 'ตัวอย่างพิมพ์แบบฟอร์ม';
  frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;border:0';
  const loaded = new Promise<void>(resolve => { frame.onload = () => resolve(); });
  frame.srcdoc = formDocumentHtml(sanitizeFormHtml(html), title);
  document.body.append(frame);
  try {
    await loaded;
    const target = frame.contentWindow;
    if (!target) throw new Error('Print frame unavailable');
    await target.document.fonts.ready;
    await Promise.all(Array.from(target.document.images, image => image.decode().catch(() => undefined)));
    target.addEventListener('afterprint', () => frame.remove(), { once: true });
    target.focus();
    target.print();
  } catch (error) {
    frame.remove();
    throw error;
  }
}
