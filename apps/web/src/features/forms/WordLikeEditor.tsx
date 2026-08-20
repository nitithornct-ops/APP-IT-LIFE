import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  Download,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Move,
  Printer,
  Redo2,
  Table2,
  Trash2,
  Underline,
  Undo2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Button } from '../../components/ui/Button';
import { FormModal } from '../../components/ui/Modal';
import { apiFetch } from '../../services/apiClient';
import type { BrandingSettings } from '../../types/settings';
import { cn } from '../../utils/cn';
import { exportHtmlAsWord, sanitizeFormHtml } from '../../utils/formHtml';

interface WordLikeEditorProps {
  value: string;
  onChange: (value: string) => void;
  fileName: string;
  readOnly?: boolean;
  className?: string;
}

interface ImageSelectionBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

const tools = [
  { command: 'undo', label: 'เลิกทำ', icon: Undo2 },
  { command: 'redo', label: 'ทำซ้ำ', icon: Redo2 },
  { command: 'bold', label: 'ตัวหนา', icon: Bold },
  { command: 'italic', label: 'ตัวเอียง', icon: Italic },
  { command: 'underline', label: 'ขีดเส้นใต้', icon: Underline },
  { command: 'insertUnorderedList', label: 'รายการหัวข้อ', icon: List },
  { command: 'insertOrderedList', label: 'รายการลำดับ', icon: ListOrdered },
  { command: 'justifyLeft', label: 'ชิดซ้าย', icon: AlignLeft },
  { command: 'justifyCenter', label: 'กึ่งกลาง', icon: AlignCenter },
  { command: 'justifyRight', label: 'ชิดขวา', icon: AlignRight },
  { command: 'justifyFull', label: 'เต็มแนว', icon: AlignJustify },
] as const;

/**
 * รูปที่แทรกจากเครื่องถูกฝังเป็น base64 ลงใน content_html ไม่ได้เก็บเป็นไฟล์แนบแยก เพื่อให้เอกสารที่
 * ดาวน์โหลดไป Word หรือสั่งพิมพ์ยังเห็นรูปครบโดยไม่ต้องพึ่งลิงก์ภายนอก ผลคือขนาดรูปกลายเป็นขนาดของ
 * แถวในฐานข้อมูลโดยตรง จึงจำกัดไว้เท่าที่โลโก้/ตราหน่วยงานต้องใช้จริง
 */
const MAX_EMBEDDED_IMAGE_BYTES = 512 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const IMAGE_WIDTHS = [
  { value: '160px', label: 'เล็ก — ขนาดโลโก้' },
  { value: '320px', label: 'กลาง' },
  { value: '100%', label: 'เต็มความกว้างกระดาษ' },
] as const;

/** ที่อยู่รูปที่ยอมให้แทรกได้ ต้องตรงกับที่ sanitizeFormHtml ยอมให้ผ่าน ไม่งั้นแทรกแล้วหายตอนบันทึก */
function isInsertableImageSrc(src: string): boolean {
  return /^https:\/\//i.test(src) || /^data:image\/(png|jpeg|gif|webp);base64,/i.test(src);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character);
}

export function WordLikeEditor({ value, onChange, fileName, readOnly = false, className }: WordLikeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef('');
  const savedRange = useRef<Range | null>(null);
  const pointerCleanup = useRef<(() => void) | null>(null);
  const [promptKind, setPromptKind] = useState<'link' | 'field' | 'image' | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [imageWidth, setImageWidth] = useState<string>(IMAGE_WIDTHS[0].value);
  const [imageError, setImageError] = useState('');
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);
  const [imageBounds, setImageBounds] = useState<ImageSelectionBounds | null>(null);

  // หน้า Vendor เปิดแบบไม่ต้องล็อกอินและเป็นโหมดอ่านอย่างเดียว จึงต้องไม่ยิงคำขอที่ต้องยืนยันตัวตน
  const brandingQuery = useQuery({
    queryKey: ['branding'],
    queryFn: () => apiFetch<BrandingSettings>('/api/v1/settings/branding'),
    staleTime: 5 * 60 * 1000,
    enabled: !readOnly,
  });
  const organizationLogoUrl = brandingQuery.data?.logoUrl ?? '';

  const updateImageBounds = useCallback((image = selectedImage) => {
    const scrollArea = scrollAreaRef.current;
    if (!image || !scrollArea || !image.isConnected) {
      setImageBounds(null);
      if (image && !image.isConnected) setSelectedImage(null);
      return;
    }
    const imageRect = image.getBoundingClientRect();
    const scrollRect = scrollArea.getBoundingClientRect();
    setImageBounds({
      left: imageRect.left - scrollRect.left + scrollArea.scrollLeft,
      top: imageRect.top - scrollRect.top + scrollArea.scrollTop,
      width: imageRect.width,
      height: imageRect.height,
    });
  }, [selectedImage]);

  const selectImage = useCallback((image: HTMLImageElement | null) => {
    setSelectedImage(image);
    if (!image) {
      setImageBounds(null);
      return;
    }
    window.requestAnimationFrame(() => updateImageBounds(image));
  }, [updateImageBounds]);

  useEffect(() => {
    if (!editorRef.current || value === lastEmitted.current) return;
    const safe = sanitizeFormHtml(value);
    editorRef.current.innerHTML = safe;
    lastEmitted.current = safe;
    selectImage(null);
  }, [selectImage, value]);

  useEffect(() => {
    const update = () => updateImageBounds();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [updateImageBounds]);

  useEffect(() => () => pointerCleanup.current?.(), []);

  function emitChange() {
    if (!editorRef.current) return;
    const next = editorRef.current.innerHTML;
    lastEmitted.current = next;
    onChange(next);
  }

  function run(command: string, valueArg?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, valueArg);
    emitChange();
  }

  /**
   * แทรกลิงก์/ฟิลด์ผ่านหน้าต่างของระบบเอง ไม่ใช่ window.prompt()
   *
   * เดิมสองเมนูนี้เรียก window.prompt() ซึ่งขัดข้อกำหนด "ห้ามใช้ Browser Native Dialog" หน้าตาไม่เข้ากับ
   * ระบบ อ่านไม่ออกบนบางเบราว์เซอร์ และทดสอบอัตโนมัติไม่ได้ (พบตอน Pre-production QA audit 2026-08-13)
   *
   * document.execCommand ทำงานกับ selection ปัจจุบัน การเปิด modal ทำให้ selection ในกล่องข้อความหาย
   * จึงต้องจำช่วงที่เลือกไว้ก่อนเปิด แล้วคืนกลับก่อนสั่งงานเสมอ
   */
  function openPrompt(kind: 'link' | 'field' | 'image') {
    const selection = window.getSelection();
    savedRange.current =
      selection && selection.rangeCount > 0 && editorRef.current?.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : null;
    setPromptValue('');
    setImageError('');
    setPromptKind(kind);
  }

  function restoreSelection() {
    editorRef.current?.focus();
    if (!savedRange.current) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(savedRange.current);
  }

  function insertImage(src: string, alt: string) {
    setPromptKind(null);
    restoreSelection();
    const sizing = imageWidth === '100%' ? 'max-width:100%' : `width:${imageWidth};max-width:100%`;
    run('insertHTML', `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" data-image-layout="inline" draggable="false" style="${sizing};height:auto;display:block;margin-left:0;margin-right:auto" /><p><br></p>`);
  }

  function imageFromEventTarget(target: EventTarget | null): HTMLImageElement | null {
    if (!(target instanceof Element)) return null;
    const image = target.closest('img');
    return image instanceof HTMLImageElement && editorRef.current?.contains(image) ? image : null;
  }

  function makeImageFree(image: HTMLImageElement) {
    const editor = editorRef.current;
    if (!editor || image.dataset.imageLayout === 'free') return;
    const imageRect = image.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    image.dataset.imageLayout = 'free';
    image.style.position = 'absolute';
    image.style.left = `${Math.max(0, imageRect.left - editorRect.left)}px`;
    image.style.top = `${Math.max(0, imageRect.top - editorRect.top)}px`;
    image.style.width = `${imageRect.width}px`;
    image.style.height = `${imageRect.height}px`;
    image.style.margin = '0';
    image.style.zIndex = '1';
  }

  function setImageInline(alignment: 'left' | 'center' | 'right' = 'left') {
    if (!selectedImage) return;
    selectedImage.dataset.imageLayout = 'inline';
    selectedImage.style.position = 'static';
    selectedImage.style.removeProperty('left');
    selectedImage.style.removeProperty('top');
    selectedImage.style.removeProperty('z-index');
    selectedImage.style.display = 'block';
    selectedImage.style.marginLeft = alignment === 'left' ? '0' : 'auto';
    selectedImage.style.marginRight = alignment === 'right' ? '0' : 'auto';
    emitChange();
    window.requestAnimationFrame(() => updateImageBounds(selectedImage));
  }

  function setImageFree() {
    if (!selectedImage) return;
    makeImageFree(selectedImage);
    emitChange();
    window.requestAnimationFrame(() => updateImageBounds(selectedImage));
  }

  function removeSelectedImage() {
    if (!selectedImage) return;
    selectedImage.remove();
    selectImage(null);
    emitChange();
  }

  function startPointerTracking(onMove: (event: PointerEvent) => void, onEnd: () => void) {
    pointerCleanup.current?.();
    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      pointerCleanup.current = null;
      onEnd();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    pointerCleanup.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }

  function handleImagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (readOnly || event.button !== 0) return;
    const image = imageFromEventTarget(event.target);
    if (!image) return;
    event.preventDefault();
    selectImage(image);
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus({ preventScroll: true });
    const startX = event.clientX;
    const startY = event.clientY;
    const initialRect = image.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const initialLeft = Math.max(0, initialRect.left - editorRect.left);
    const initialTop = Math.max(0, initialRect.top - editorRect.top);
    let didMove = false;

    startPointerTracking((pointerEvent) => {
      const deltaX = pointerEvent.clientX - startX;
      const deltaY = pointerEvent.clientY - startY;
      if (!didMove && Math.hypot(deltaX, deltaY) < 3) return;
      if (!didMove) {
        makeImageFree(image);
        didMove = true;
      }
      const maxLeft = Math.max(0, editor.clientWidth - image.offsetWidth);
      const maxTop = Math.max(0, editor.scrollHeight - image.offsetHeight);
      image.style.left = `${Math.min(maxLeft, Math.max(0, initialLeft + deltaX))}px`;
      image.style.top = `${Math.min(maxTop, Math.max(0, initialTop + deltaY))}px`;
      updateImageBounds(image);
    }, () => {
      if (didMove) emitChange();
      updateImageBounds(image);
    });
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLButtonElement>, horizontalDirection: -1 | 1) {
    if (!selectedImage || !editorRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const image = selectedImage;
    const editor = editorRef.current;
    const startX = event.clientX;
    const startRect = image.getBoundingClientRect();
    const startWidth = startRect.width;
    const aspectRatio = startRect.height > 0 ? startRect.width / startRect.height : 1;
    const startLeft = Number.parseFloat(image.style.left) || image.offsetLeft || 0;
    const isFree = image.dataset.imageLayout === 'free';
    const maxWidth = Math.max(40, horizontalDirection < 0 && isFree
      ? startLeft + startWidth
      : editor.clientWidth - startLeft);

    startPointerTracking((pointerEvent) => {
      const requestedWidth = startWidth + ((pointerEvent.clientX - startX) * horizontalDirection);
      const nextWidth = Math.min(maxWidth, Math.max(40, requestedWidth));
      image.style.width = `${nextWidth}px`;
      image.style.maxWidth = '100%';
      image.style.height = `${nextWidth / aspectRatio}px`;
      if (horizontalDirection < 0 && isFree) {
        image.style.left = `${Math.max(0, startLeft - (nextWidth - startWidth))}px`;
      }
      updateImageBounds(image);
    }, () => {
      emitChange();
      updateImageBounds(image);
    });
  }

  function handleEditorKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!selectedImage || readOnly) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeSelectedImage();
      return;
    }
    if (event.key === 'Escape') {
      selectImage(null);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    makeImageFree(selectedImage);
    const step = event.shiftKey ? 10 : 1;
    const currentLeft = Number.parseFloat(selectedImage.style.left) || 0;
    const currentTop = Number.parseFloat(selectedImage.style.top) || 0;
    const nextLeft = currentLeft + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0);
    const nextTop = currentTop + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
    selectedImage.style.left = `${Math.max(0, nextLeft)}px`;
    selectedImage.style.top = `${Math.max(0, nextTop)}px`;
    emitChange();
    updateImageBounds(selectedImage);
  }

  function insertImageFile(file: File) {
    setImageError('');
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setImageError('รองรับเฉพาะไฟล์ PNG, JPG, GIF และ WebP');
      return;
    }
    if (file.size > MAX_EMBEDDED_IMAGE_BYTES) {
      setImageError(`ไฟล์ใหญ่ ${Math.round(file.size / 1024)} KB เกินที่รับได้ ${MAX_EMBEDDED_IMAGE_BYTES / 1024} KB — ย่อรูปก่อนแล้วลองใหม่`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setImageError('อ่านไฟล์ไม่สำเร็จ กรุณาลองใหม่');
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!isInsertableImageSrc(result)) {
        setImageError('ไฟล์นี้ไม่ใช่รูปภาพที่รองรับ');
        return;
      }
      insertImage(result, file.name.replace(/\.[^.]+$/, ''));
    };
    reader.readAsDataURL(file);
  }

  function submitPrompt() {
    const value = promptValue.trim();
    const kind = promptKind;
    if (!value || !kind) return;
    if (kind === 'image') {
      if (!isInsertableImageSrc(value)) {
        setImageError('ใส่ได้เฉพาะที่อยู่รูปที่ขึ้นต้นด้วย https:// เท่านั้น');
        return;
      }
      insertImage(value, '');
      return;
    }
    setPromptKind(null);
    restoreSelection();
    if (kind === 'link') {
      run('createLink', value);
      return;
    }
    // ชื่อฟิลด์มาจากสิ่งที่ผู้ใช้พิมพ์ จึงต้อง escape ก่อนต่อเป็น HTML — data-field คงไว้เป็น ASCII
    // เพื่อให้อ้างอิงในโค้ดได้ ส่วนข้อความที่แสดงคงอักษรไทยไว้ตามที่พิมพ์
    const safeField = value.replace(/[^a-zA-Z0-9_.-]/g, '_');
    run('insertHTML', `<span class="form-variable" data-field="${safeField}">{{${escapeHtml(value)}}}</span>&nbsp;`);
  }

  function insertTable() {
    run('insertHTML', '<table><thead><tr><th>หัวข้อ</th><th>รายละเอียด</th></tr></thead><tbody><tr><td>รายการ</td><td>กรอกข้อมูล</td></tr><tr><td>รายการ</td><td>กรอกข้อมูล</td></tr></tbody></table><p><br></p>');
  }

  return (
    <div className={cn('overflow-hidden rounded-xl border border-slate-300 bg-slate-200 shadow-sm dark:border-slate-600 dark:bg-slate-900', className)}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-slate-300 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-800">
        {!readOnly && <>
          <button type="button" className="form-toolbar-label" onMouseDown={(event) => event.preventDefault()} onClick={() => run('formatBlock', 'p')}>ปกติ</button>
          <button type="button" className="form-toolbar-label" onMouseDown={(event) => event.preventDefault()} onClick={() => run('formatBlock', 'h2')}>หัวข้อ 1</button>
          <button type="button" className="form-toolbar-label" onMouseDown={(event) => event.preventDefault()} onClick={() => run('formatBlock', 'h3')}>หัวข้อ 2</button>
          <span className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" />
          {tools.map(({ command, label, icon: Icon }) => <button key={command} type="button" title={label} aria-label={label} className="form-toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={() => run(command)}><Icon className="h-4 w-4" /></button>)}
          <span className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" />
          <button type="button" title="แทรกลิงก์" aria-label="แทรกลิงก์" className="form-toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={() => openPrompt('link')}><Link2 className="h-4 w-4" /></button>
          <button type="button" title="แทรกตาราง" aria-label="แทรกตาราง" className="form-toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={insertTable}><Table2 className="h-4 w-4" /></button>
          <button type="button" title="แทรกรูปภาพ / โลโก้" aria-label="แทรกรูปภาพ / โลโก้" className="form-toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={() => openPrompt('image')}><ImageIcon className="h-4 w-4" /></button>
          <button type="button" title="แทรกตัวแปรฟิลด์" aria-label="แทรกตัวแปรฟิลด์" className="form-toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={() => openPrompt('field')}><Braces className="h-4 w-4" /></button>
          <button type="button" title="เส้นคั่น" aria-label="เส้นคั่น" className="form-toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={() => run('insertHorizontalRule')}><Minus className="h-4 w-4" /></button>
        </>}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" title="ดาวน์โหลดไปเปิดใน Word" aria-label="ดาวน์โหลดไปเปิดใน Word" className="form-toolbar-button" onClick={() => exportHtmlAsWord(editorRef.current?.innerHTML ?? value, fileName)}><Download className="h-4 w-4" /></button>
          <button type="button" title="พิมพ์ / บันทึก PDF" aria-label="พิมพ์ / บันทึก PDF" className="form-toolbar-button" onClick={() => window.print()}><Printer className="h-4 w-4" /></button>
        </span>
      </div>
      <div
        id="form-print-area"
        ref={scrollAreaRef}
        onScroll={() => updateImageBounds()}
        className="relative max-h-[calc(100vh-260px)] overflow-auto px-3 py-5 md:px-8"
      >
        <div
          ref={editorRef}
          role="textbox"
          aria-label="พื้นที่แก้ไขแบบฟอร์ม"
          aria-multiline="true"
          contentEditable={!readOnly}
          suppressContentEditableWarning
          spellCheck
          onInput={emitChange}
          onClick={(event) => selectImage(readOnly ? null : imageFromEventTarget(event.target))}
          onPointerDown={handleImagePointerDown}
          onDragStart={(event) => {
            if (imageFromEventTarget(event.target)) event.preventDefault();
          }}
          onKeyDown={handleEditorKeyDown}
          className={cn('form-document mx-auto bg-white text-slate-900 shadow-xl outline-none', readOnly && 'cursor-default')}
        />
        {!readOnly && selectedImage && imageBounds && (
          <div
            data-testid="editor-image-selection"
            className="form-image-selection"
            style={{ left: imageBounds.left, top: imageBounds.top, width: imageBounds.width, height: imageBounds.height }}
          >
            <div
              role="toolbar"
              aria-label="เครื่องมือจัดรูปภาพ"
              className={cn('form-image-context-toolbar', imageBounds.top < 52 && 'form-image-context-toolbar-below')}
            >
              <span className="whitespace-nowrap px-1 text-[11px] font-bold text-slate-500">รูปภาพ</span>
              <button type="button" title="ลากย้ายอิสระ" aria-label="ลากย้ายอิสระ" onClick={setImageFree}><Move className="h-3.5 w-3.5" /></button>
              <button type="button" title="วางตามแนวข้อความ ชิดซ้าย" aria-label="วางตามแนวข้อความ ชิดซ้าย" onClick={() => setImageInline('left')}><AlignLeft className="h-3.5 w-3.5" /></button>
              <button type="button" title="วางตามแนวข้อความ กึ่งกลาง" aria-label="วางตามแนวข้อความ กึ่งกลาง" onClick={() => setImageInline('center')}><AlignCenter className="h-3.5 w-3.5" /></button>
              <button type="button" title="วางตามแนวข้อความ ชิดขวา" aria-label="วางตามแนวข้อความ ชิดขวา" onClick={() => setImageInline('right')}><AlignRight className="h-3.5 w-3.5" /></button>
              <button type="button" title="ลบรูปภาพ" aria-label="ลบรูปภาพ" className="text-rose-600" onClick={removeSelectedImage}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <button type="button" aria-label="ปรับขนาดรูปจากมุมซ้ายบน" className="form-image-resize-handle -left-1.5 -top-1.5 cursor-nwse-resize" onPointerDown={(event) => handleResizePointerDown(event, -1)} />
            <button type="button" aria-label="ปรับขนาดรูปจากมุมขวาบน" className="form-image-resize-handle -right-1.5 -top-1.5 cursor-nesw-resize" onPointerDown={(event) => handleResizePointerDown(event, 1)} />
            <button type="button" aria-label="ปรับขนาดรูปจากมุมซ้ายล่าง" className="form-image-resize-handle -bottom-1.5 -left-1.5 cursor-nesw-resize" onPointerDown={(event) => handleResizePointerDown(event, -1)} />
            <button type="button" aria-label="ปรับขนาดรูปจากมุมขวาล่าง" className="form-image-resize-handle -bottom-1.5 -right-1.5 cursor-nwse-resize" onPointerDown={(event) => handleResizePointerDown(event, 1)} />
          </div>
        )}
      </div>

      {promptKind && (
        <FormModal
          title={promptKind === 'link' ? 'แทรกลิงก์' : promptKind === 'image' ? 'แทรกรูปภาพ / โลโก้' : 'แทรกตัวแปรฟิลด์'}
          description={
            promptKind === 'link'
              ? 'วาง URL ปลายทางที่ต้องการเชื่อมโยงกับข้อความที่เลือกไว้'
              : promptKind === 'image'
                ? 'รูปจะถูกฝังลงในเอกสาร จึงติดไปด้วยเมื่อดาวน์โหลดเป็น Word หรือสั่งพิมพ์'
                : 'ชื่อฟิลด์สำหรับกรอกข้อมูลลงในเอกสาร เช่น requester_name หรือ ticket_no'
          }
          size="sm"
          closeTestId="editor-prompt-close"
          onClose={() => setPromptKind(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitPrompt();
            }}
            className="flex flex-col gap-3"
          >
            {promptKind === 'image' && (
              <>
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  ขนาดที่จะแสดง
                  <select
                    data-testid="editor-image-width"
                    value={imageWidth}
                    onChange={(event) => setImageWidth(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  >
                    {IMAGE_WIDTHS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                {organizationLogoUrl && (
                  <Button type="button" variant="outline" size="sm" data-testid="editor-image-use-org-logo" onClick={() => insertImage(organizationLogoUrl, 'โลโก้หน่วยงาน')}>
                    ใช้โลโก้หน่วยงานที่ตั้งไว้ในระบบ
                  </Button>
                )}
                <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  เลือกไฟล์รูปจากเครื่อง
                  <input
                    data-testid="editor-image-file"
                    type="file"
                    accept={ALLOWED_IMAGE_TYPES.join(',')}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) insertImageFile(file);
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">
                    PNG, JPG, GIF หรือ WebP ขนาดไม่เกิน {MAX_EMBEDDED_IMAGE_BYTES / 1024} KB
                  </span>
                </label>
              </>
            )}
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {promptKind === 'link' ? 'URL' : promptKind === 'image' ? 'หรือวางที่อยู่รูปภาพ' : 'ชื่อฟิลด์'}
              <input
                data-autofocus
                data-testid="editor-prompt-input"
                type={promptKind === 'field' ? 'text' : 'url'}
                value={promptValue}
                onChange={(event) => setPromptValue(event.target.value)}
                placeholder={promptKind === 'field' ? 'requester_name' : 'https://example.com'}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            {imageError && <p role="alert" data-testid="editor-image-error" className="text-sm font-semibold text-rose-600 dark:text-rose-400">{imageError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPromptKind(null)}>ยกเลิก</Button>
              <Button type="submit" size="sm" data-testid="editor-prompt-submit" disabled={!promptValue.trim()}>แทรก</Button>
            </div>
          </form>
        </FormModal>
      )}
    </div>
  );
}
