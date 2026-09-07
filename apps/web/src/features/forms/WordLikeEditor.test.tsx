import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WordLikeEditor } from './WordLikeEditor';
import { sanitizeFormHtml } from '../../utils/formHtml';

vi.mock('../../services/apiClient', () => ({
  apiFetch: vi.fn().mockResolvedValue({ logoUrl: '' }),
}));

/**
 * jsdom ไม่ขยับเคอร์เซอร์ตามการคลิกเหมือนเบราว์เซอร์จริง ต้องวางช่วงที่เลือกเองแล้วปล่อยแป้น
 * เพื่อให้ตัวแก้ไขรู้ว่าตอนนี้ทำงานอยู่กับบล็อกไหน
 */
function selectBlock(editor: HTMLElement, block: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(block);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent.keyUp(editor, { key: 'ArrowDown' });
}

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

  const blockAt = (index: number) => editor.children[index] as HTMLElement;

  return { editor, image, blockAt, onChange };
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

  /**
   * ตำแหน่งที่ลากต้องรอดผ่านตัวกรอง HTML ด้วย ไม่งั้นรูปจะเด้งกลับที่เดิมทุกครั้งที่บันทึกแล้วเปิดใหม่
   * ซึ่งเป็นอาการที่ทำให้ปุ่ม "ลากย้ายอิสระ" ใช้งานจริงไม่ได้มาก่อนหน้านี้
   */
  it('turns an image into a freely positioned image when it is dragged, and the position survives a save', async () => {
    const { image, onChange } = renderEditor();

    fireEvent.pointerDown(image, { button: 0, clientX: 150, clientY: 170 });
    fireEvent.pointerMove(window, { clientX: 210, clientY: 220 });
    fireEvent.pointerUp(window);

    await waitFor(() => expect(image.dataset.imageLayout).toBe('free'));
    expect(image.style.position).toBe('relative');
    expect(image.style.left).toBe('60px');
    expect(image.style.top).toBe('50px');
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('data-image-layout="free"'));

    const saved = sanitizeFormHtml(onChange.mock.calls.at(-1)![0] as string);
    expect(saved).toContain('position:relative');
    expect(saved).toContain('left:60px');
    expect(saved).toContain('top:50px');
  });

  it('supports precise keyboard movement and deletion for the selected image', async () => {
    const { editor, image, onChange } = renderEditor();

    fireEvent.click(image);
    await screen.findByRole('toolbar', { name: 'เครื่องมือจัดรูปภาพ' });
    fireEvent.keyDown(editor, { key: 'ArrowRight', shiftKey: true });

    expect(image.dataset.imageLayout).toBe('free');
    expect(image.style.left).toBe('10px');
    expect(onChange).toHaveBeenCalled();

    fireEvent.keyDown(editor, { key: 'Delete' });
    expect(image).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'เครื่องมือจัดรูปภาพ' })).not.toBeInTheDocument();
  });

  it('puts an image back in the text flow when it is aligned again', async () => {
    const { image } = renderEditor();

    fireEvent.pointerDown(image, { button: 0, clientX: 150, clientY: 170 });
    fireEvent.pointerMove(window, { clientX: 210, clientY: 220 });
    fireEvent.pointerUp(window);
    await waitFor(() => expect(image.style.position).toBe('relative'));

    fireEvent.click(image);
    fireEvent.click(await screen.findByRole('button', { name: 'วางตามแนวข้อความ ชิดซ้าย' }));

    expect(image.style.position).toBe('');
    expect(image.style.left).toBe('');
    expect(image.dataset.imageLayout).toBe('inline');
  });
});

describe('WordLikeEditor block controls', () => {
  it('offers move handles for the block the cursor is in, and moves it in the flow', async () => {
    const { editor, blockAt, onChange } = renderEditor();
    const firstParagraph = blockAt(0);

    selectBlock(editor, firstParagraph);
    expect(await screen.findByRole('toolbar', { name: 'เครื่องมือย้ายบล็อก' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'ย้ายบล็อกขึ้น' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'ย้ายบล็อกลง' }));

    expect(blockAt(0).tagName).toBe('IMG');
    expect(blockAt(1)).toBe(firstParagraph);
    expect(onChange).toHaveBeenCalled();
  });

  it('reorders blocks from the keyboard as well as the handles', async () => {
    const { editor, blockAt } = renderEditor();
    const firstParagraph = blockAt(0);

    selectBlock(editor, firstParagraph);
    await screen.findByRole('toolbar', { name: 'เครื่องมือย้ายบล็อก' });
    fireEvent.keyDown(editor, { key: 'ArrowDown', altKey: true });

    expect(blockAt(1)).toBe(firstParagraph);
  });

  /** ข้อความที่ลากได้คือเหตุผลของงานนี้ ระยะที่ลากต้องรอดผ่านตัวกรองเหมือนกับของรูป */
  it('drags a text block to a new position that survives a save', async () => {
    const { editor, blockAt, onChange } = renderEditor();
    const paragraph = blockAt(0);
    paragraph.getBoundingClientRect = () => new DOMRect(140, 200, 300, 24);

    selectBlock(editor, paragraph);
    const handle = await screen.findByRole('button', { name: 'ลากเพื่อย้ายตำแหน่งบล็อกนี้' });
    fireEvent.pointerDown(handle, { button: 0, clientX: 120, clientY: 210 });
    fireEvent.pointerMove(window, { clientX: 180, clientY: 240 });
    fireEvent.pointerUp(window);

    expect(paragraph.style.position).toBe('relative');
    expect(paragraph.style.left).toBe('60px');
    expect(paragraph.style.top).toBe('30px');

    const saved = sanitizeFormHtml(onChange.mock.calls.at(-1)![0] as string);
    expect(saved).toContain('position:relative');
    expect(saved).toContain('left:60px');
  });

  it('offers to put a dragged block back exactly where it belonged', async () => {
    const { editor, blockAt } = renderEditor();
    const paragraph = blockAt(0);
    paragraph.getBoundingClientRect = () => new DOMRect(140, 200, 300, 24);

    selectBlock(editor, paragraph);
    const handle = await screen.findByRole('button', { name: 'ลากเพื่อย้ายตำแหน่งบล็อกนี้' });
    expect(screen.queryByRole('button', { name: 'คืนตำแหน่งเดิม' })).not.toBeInTheDocument();

    fireEvent.pointerDown(handle, { button: 0, clientX: 120, clientY: 210 });
    fireEvent.pointerMove(window, { clientX: 180, clientY: 240 });
    fireEvent.pointerUp(window);

    fireEvent.click(await screen.findByRole('button', { name: 'คืนตำแหน่งเดิม' }));

    expect(paragraph.hasAttribute('style')).toBe(false);
  });
});
