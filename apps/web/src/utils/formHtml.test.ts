import { describe, expect, it, vi } from 'vitest';
import { exportHtmlAsWord, sanitizeFormHtml } from './formHtml';

describe('form HTML utilities', () => {
  it('removes executable content while preserving document formatting', () => {
    const safe = sanitizeFormHtml('<h1 onclick="alert(1)">Title</h1><script>alert(1)</script><a href="javascript:alert(1)">link</a><table><tr><td>data</td></tr></table>');
    expect(safe).toContain('<h1>Title</h1>');
    expect(safe).toContain('<table>');
    expect(safe).not.toContain('script');
    expect(safe).not.toContain('onclick');
    expect(safe).not.toContain('javascript:');
  });

  /**
   * โลโก้บนหัวกระดาษถูกฝังเป็น data:image/... ถ้าตัวกรองตัดทิ้ง รูปจะหายทุกครั้งที่เปิดแบบฟอร์มขึ้นมาแก้
   * เพราะเนื้อหาถูกกรองใหม่ทุกครั้งที่โหลดเข้า editor
   */
  it('keeps an embedded logo image so it survives every reload of the form', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const safe = sanitizeFormHtml(`<p><img src="${png}" alt="โลโก้หน่วยงาน" style="width:160px" /></p>`);
    expect(safe).toContain(png);
    expect(safe).toContain('โลโก้หน่วยงาน');
  });

  it('keeps an image served over https', () => {
    const safe = sanitizeFormHtml('<img src="https://example.supabase.co/storage/v1/object/public/branding/logo.png" alt="" />');
    expect(safe).toContain('https://example.supabase.co/storage/v1/object/public/branding/logo.png');
  });

  it('refuses a data URL that is not an image, however it is dressed up', () => {
    for (const hostile of [
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+',
      'data:application/javascript;base64,YWxlcnQoMSk=',
    ]) {
      const safe = sanitizeFormHtml(`<img src="${hostile}" />`);
      expect(safe).not.toContain(hostile);
      expect(safe).not.toContain(' src=');
    }
  });

  it('blocks foreign namespaces, encoded script URLs, and overlay CSS', () => {
    const safe = sanitizeFormHtml(`
      <svg><a xlink:href="javascript:alert(1)"><text>svg trap</text></a></svg>
      <math><mtext><img src=x onerror=alert(1)></mtext></math>
      <a href="&#106;avascript:alert(1)" target="_blank">link</a>
      <img src="https://example.test/logo.png" style="position:fixed;inset:0;z-index:9999;width:160px;height:auto">
    `);
    expect(safe).not.toMatch(/svg|math|xlink|javascript|onerror|position|inset|z-index/i);
    expect(safe).toContain('width:160px');
    expect(safe).toContain('height:auto');
    expect(safe).toContain('rel="noopener noreferrer"');
  });

  it('keeps a page-break marker so a saved form still splits where the user asked', () => {
    const html = sanitizeFormHtml('<p>หน้าแรก</p><div class="form-page-break"></div><p>หน้าถัดไป</p>');
    expect(html).toContain('class="form-page-break"');
  });

  it('drops any other class so a form cannot borrow styles from the app itself', () => {
    const html = sanitizeFormHtml('<div class="fixed inset-0 z-50">ทับหน้าจอ</div><span class="ticket-form-checkbox">x</span>');
    expect(html).not.toContain('class=');
  });

  it('builds a Word-compatible download', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    exportHtmlAsWord('<h1>Test</h1>', 'test/form');
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
    click.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });
});

