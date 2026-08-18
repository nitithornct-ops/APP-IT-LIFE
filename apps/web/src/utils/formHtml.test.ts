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
      expect(safe).toContain('src="#"');
    }
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

