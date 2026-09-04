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
});
