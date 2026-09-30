import { afterEach, describe, expect, it, vi } from 'vitest';
import { printFormDocument } from './printFormDocument';

describe('printFormDocument', () => {
  afterEach(() => {
    document.body.querySelectorAll('iframe').forEach((frame) => frame.remove());
    vi.restoreAllMocks();
  });

  it('prints sanitized content in an isolated iframe and removes it after printing', async () => {
    const frame = document.createElement('iframe');
    const afterPrint = vi.fn();
    const target = {
      document: {
        fonts: { ready: Promise.resolve() },
        images: [],
      },
      addEventListener: vi.fn((_event: string, listener: EventListener) => {
        afterPrint.mockImplementation(listener);
      }),
      focus: vi.fn(),
      print: vi.fn(),
    } as unknown as Window;

    Object.defineProperty(frame, 'contentWindow', { configurable: true, value: target });
    const createElement = vi.spyOn(document, 'createElement');
    createElement.mockImplementation((tagName: string) => tagName === 'iframe'
      ? frame
      : document.createElementNS('http://www.w3.org/1999/xhtml', tagName));

    const printing = printFormDocument('<h1 onclick="alert(1)">Title</h1><script>alert(1)</script>', 'Test form');
    frame.onload?.(new Event('load'));
    await printing;

    expect(frame.srcdoc).toContain('Title');
    expect(frame.srcdoc).not.toContain('<script>');
    expect(target.focus).toHaveBeenCalledOnce();
    expect(target.print).toHaveBeenCalledOnce();
    expect(target.addEventListener).toHaveBeenCalledWith('afterprint', expect.any(Function), { once: true });

    afterPrint(new Event('afterprint'));
    expect(frame.isConnected).toBe(false);
  });

  it('removes the iframe and rejects when the print window is unavailable', async () => {
    const frame = document.createElement('iframe');
    Object.defineProperty(frame, 'contentWindow', { configurable: true, value: null });
    const createElement = vi.spyOn(document, 'createElement');
    createElement.mockImplementation((tagName: string) => tagName === 'iframe'
      ? frame
      : document.createElementNS('http://www.w3.org/1999/xhtml', tagName));

    const printing = printFormDocument('<p>Test</p>', 'Test form');
    frame.onload?.(new Event('load'));

    await expect(printing).rejects.toThrow('Print frame unavailable');
    expect(frame.isConnected).toBe(false);
  });
});
