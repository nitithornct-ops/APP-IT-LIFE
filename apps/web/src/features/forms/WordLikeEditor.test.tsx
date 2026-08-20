import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WordLikeEditor } from './WordLikeEditor';

vi.mock('../../services/apiClient', () => ({
  apiFetch: vi.fn().mockResolvedValue({ logoUrl: '' }),
}));

function renderEditor(onChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WordLikeEditor
        value={'<p>ก่อนรูป</p><img src="https://example.com/sample.png" alt="ตัวอย่าง" style="width:100px;height:auto"><p>หลังรูป</p>'}
        onChange={onChange}
        fileName="test-form"
      />
    </QueryClientProvider>,
  );
  const editor = screen.getByRole('textbox', { name: 'พื้นที่แก้ไขแบบฟอร์ม' });
  const image = view.container.querySelector('.form-document img') as HTMLImageElement;
  const scrollArea = view.container.querySelector('#form-print-area') as HTMLDivElement;

  Object.defineProperties(editor, {
    clientWidth: { configurable: true, value: 700 },
    scrollHeight: { configurable: true, value: 900 },
  });
  Object.defineProperties(image, {
    offsetWidth: { configurable: true, value: 100 },
    offsetHeight: { configurable: true, value: 50 },
  });
  editor.getBoundingClientRect = () => new DOMRect(100, 100, 700, 900);
  image.getBoundingClientRect = () => new DOMRect(140, 160, Number.parseFloat(image.style.width) || 100, 50);
  scrollArea.getBoundingClientRect = () => new DOMRect(0, 0, 900, 700);

  return { editor, image, onChange };
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WordLikeEditor image controls', () => {
  it('selects existing images and aligns them like an inline Word image', async () => {
    const { image, onChange } = renderEditor();

    fireEvent.click(image);
    expect(await screen.findByRole('toolbar', { name: 'เครื่องมือจัดรูปภาพ' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'วางตามแนวข้อความ กึ่งกลาง' }));

    expect(image.dataset.imageLayout).toBe('inline');
    expect(image.style.marginLeft).toBe('auto');
    expect(image.style.marginRight).toBe('auto');
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('data-image-layout="inline"'));
  });

  it('turns an image into a freely positioned image when it is dragged', async () => {
    const { image, onChange } = renderEditor();

    fireEvent.pointerDown(image, { button: 0, clientX: 150, clientY: 170 });
    fireEvent.pointerMove(window, { clientX: 210, clientY: 220 });
    fireEvent.pointerUp(window);

    await waitFor(() => expect(image.dataset.imageLayout).toBe('free'));
    expect(image.style.position).toBe('absolute');
    expect(image.style.left).toBe('100px');
    expect(image.style.top).toBe('110px');
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('data-image-layout="free"'));
  });

  it('supports precise keyboard movement and deletion for the selected image', async () => {
    const { editor, image, onChange } = renderEditor();

    fireEvent.click(image);
    await screen.findByRole('toolbar', { name: 'เครื่องมือจัดรูปภาพ' });
    fireEvent.keyDown(editor, { key: 'ArrowRight', shiftKey: true });

    expect(image.dataset.imageLayout).toBe('free');
    expect(image.style.left).toBe('50px');
    expect(onChange).toHaveBeenCalled();

    fireEvent.keyDown(editor, { key: 'Delete' });
    expect(image).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'เครื่องมือจัดรูปภาพ' })).not.toBeInTheDocument();
  });
});
