import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  Download,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Printer,
  Redo2,
  Table2,
  Underline,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { FormModal } from '../../components/ui/Modal';
import { cn } from '../../utils/cn';
import { exportHtmlAsWord, sanitizeFormHtml } from '../../utils/formHtml';

interface WordLikeEditorProps {
  value: string;
  onChange: (value: string) => void;
  fileName: string;
  readOnly?: boolean;
  className?: string;
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

export function WordLikeEditor({ value, onChange, fileName, readOnly = false, className }: WordLikeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef('');
  const savedRange = useRef<Range | null>(null);
  const [promptKind, setPromptKind] = useState<'link' | 'field' | null>(null);
  const [promptValue, setPromptValue] = useState('');

  useEffect(() => {
    if (!editorRef.current || value === lastEmitted.current) return;
    const safe = sanitizeFormHtml(value);
    editorRef.current.innerHTML = safe;
    lastEmitted.current = safe;
  }, [value]);

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
  function openPrompt(kind: 'link' | 'field') {
    const selection = window.getSelection();
    savedRange.current =
      selection && selection.rangeCount > 0 && editorRef.current?.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : null;
    setPromptValue('');
    setPromptKind(kind);
  }

  function restoreSelection() {
    editorRef.current?.focus();
    if (!savedRange.current) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(savedRange.current);
  }

  function submitPrompt() {
    const value = promptValue.trim();
    const kind = promptKind;
    setPromptKind(null);
    if (!value || !kind) return;
    restoreSelection();
    if (kind === 'link') {
      run('createLink', value);
      return;
    }
    const safeField = value.replace(/[^a-zA-Z0-9_.-]/g, '_');
    run('insertHTML', `<span class="form-variable" data-field="${safeField}">{{${value}}}</span>&nbsp;`);
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
          <button type="button" title="แทรกตัวแปรฟิลด์" aria-label="แทรกตัวแปรฟิลด์" className="form-toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={() => openPrompt('field')}><Braces className="h-4 w-4" /></button>
          <button type="button" title="เส้นคั่น" aria-label="เส้นคั่น" className="form-toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={() => run('insertHorizontalRule')}><Minus className="h-4 w-4" /></button>
        </>}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" title="ดาวน์โหลดไปเปิดใน Word" aria-label="ดาวน์โหลดไปเปิดใน Word" className="form-toolbar-button" onClick={() => exportHtmlAsWord(editorRef.current?.innerHTML ?? value, fileName)}><Download className="h-4 w-4" /></button>
          <button type="button" title="พิมพ์ / บันทึก PDF" aria-label="พิมพ์ / บันทึก PDF" className="form-toolbar-button" onClick={() => window.print()}><Printer className="h-4 w-4" /></button>
        </span>
      </div>
      <div id="form-print-area" className="max-h-[calc(100vh-260px)] overflow-auto px-3 py-5 md:px-8">
        <div
          ref={editorRef}
          role="textbox"
          aria-label="พื้นที่แก้ไขแบบฟอร์ม"
          aria-multiline="true"
          contentEditable={!readOnly}
          suppressContentEditableWarning
          spellCheck
          onInput={emitChange}
          className={cn('form-document mx-auto bg-white text-slate-900 shadow-xl outline-none', readOnly && 'cursor-default')}
        />
      </div>

      {promptKind && (
        <FormModal
          title={promptKind === 'link' ? 'แทรกลิงก์' : 'แทรกตัวแปรฟิลด์'}
          description={
            promptKind === 'link'
              ? 'วาง URL ปลายทางที่ต้องการเชื่อมโยงกับข้อความที่เลือกไว้'
              : 'ชื่อฟิลด์ที่จะถูกแทนค่าจริงตอนพิมพ์เอกสาร เช่น requester_name หรือ ticket_no'
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
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {promptKind === 'link' ? 'URL' : 'ชื่อฟิลด์'}
              <input
                data-autofocus
                data-testid="editor-prompt-input"
                type={promptKind === 'link' ? 'url' : 'text'}
                value={promptValue}
                onChange={(event) => setPromptValue(event.target.value)}
                placeholder={promptKind === 'link' ? 'https://example.com' : 'requester_name'}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
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
