import { describe, expect, it } from 'vitest';
import { sanitizeFormHtml } from '../src/utils/formHtml';

describe('API form HTML sanitizer', () => {
  it('uses a strict allowlist for tags, namespaces, attributes, URLs, and CSS', () => {
    const safe = sanitizeFormHtml(`
      <h2 onclick="alert(1)">หัวข้อ</h2>
      <svg><a xlink:href="javascript:alert(1)"><text>svg trap</text></a></svg>
      <math><mtext><img src=x onerror=alert(1)></mtext></math>
      <a href="&#106;avascript:alert(1)" target="_blank">bad link</a>
      <img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" style="position:fixed;inset:0;width:100%">
      <table><tr><td style="text-align:center;background:url(javascript:alert(1))">ข้อมูล</td></tr></table>
    `);

    expect(safe).toContain('<h2>หัวข้อ</h2>');
    expect(safe).toContain('<table>');
    expect(safe).toContain('text-align:center');
    expect(safe).not.toMatch(/<\/?(?:svg|math)|xlink|javascript|onerror|onclick|position|background/i);
    expect(safe).not.toContain('data:image/svg+xml');
  });

  it('preserves supported document markup and raster images', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const safe = sanitizeFormHtml(`<p style="text-align:right"><strong>เอกสาร</strong></p><img src="${png}" alt="logo" style="width:160px;height:auto;display:block;margin-left:auto;margin-right:0"><span class="form-variable" data-field="requester_name">{{name}}</span>`);
    expect(safe).toContain(png);
    expect(safe).toContain('width:160px');
    expect(safe).toContain('class="form-variable"');
    expect(safe).toContain('data-field="requester_name"');
  });

  /**
   * The trust boundary has to let a dragged block keep its offset, or every position a user sets in
   * the browser is thrown away by the save that follows it.
   */
  it('keeps a relative offset on a dragged block but refuses overlay positioning', () => {
    const moved = sanitizeFormHtml('<p style="position:relative;left:-40px;top:120px;z-index:2">ย้ายแล้ว</p>');
    expect(moved).toContain('position:relative');
    expect(moved).toContain('left:-40px');
    expect(moved).toContain('top:120px');
    expect(moved).toContain('z-index:2');

    for (const value of ['absolute', 'fixed', 'sticky']) {
      const overlay = sanitizeFormHtml(`<div style="position:${value};left:0;top:0;z-index:9999">ทับหน้าจอ</div>`);
      expect(overlay).not.toContain('position');
      expect(overlay).not.toContain('z-index');
    }

    const runaway = sanitizeFormHtml('<p style="position:relative;left:-99999px;top:50vh">หนีออกนอกหน้า</p>');
    expect(runaway).toContain('position:relative');
    expect(runaway).not.toContain('left');
    expect(runaway).not.toContain('top');
  });

  it('keeps only the image layout markers the editor writes', () => {
    expect(sanitizeFormHtml('<img src="https://x.test/a.png" data-image-layout="free">')).toContain('data-image-layout="free"');
    expect(sanitizeFormHtml('<img src="https://x.test/a.png" data-image-layout="overlay">')).not.toContain('data-image-layout');
  });

  it('keeps the page-break marker but no other class', () => {
    const safe = sanitizeFormHtml('<p>หน้าแรก</p><div class="form-page-break"></div><div class="fixed inset-0">ทับหน้าจอ</div>');
    expect(safe).toContain('class="form-page-break"');
    expect(safe).not.toContain('fixed inset-0');
  });
});
