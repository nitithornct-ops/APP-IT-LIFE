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

