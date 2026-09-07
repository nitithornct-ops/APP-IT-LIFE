import { ChevronLeft, ChevronRight, Copy, FileText, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import type { DragEvent } from 'react';
import { cn } from '../../utils/cn';
import type { WorkPage } from './pdfDocumentEngine';

export interface PdfPageCardProps {
  page: WorkPage;
  index: number;
  total: number;
  sourceName: string;
  thumbnail?: string;
  selected: boolean;
  /** true เมื่อ pdf.js ใช้ไม่ได้ — ซ่อนข้อความ "กำลังสร้างภาพย่อ" ที่จะไม่มีวันเสร็จ */
  previewUnavailable: boolean;
  onToggle: () => void;
  onRotate: (delta: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (offset: number) => void;
  onDragStart: (event: DragEvent<HTMLLIElement>) => void;
  onDragOver: (event: DragEvent<HTMLLIElement>) => void;
  onDrop: (event: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  isDropTarget: boolean;
}

const actionButtonClass =
  'grid h-7 w-7 place-items-center rounded-[6px] border border-hairline-control bg-white text-slate-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[.12] dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700';

/**
 * การ์ดหนึ่งหน้าเอกสารในพื้นที่ทำงาน
 *
 * ทุกคำสั่งมีปุ่มที่กดด้วยแป้นพิมพ์ได้ควบคู่กับการลากวาง เพราะการลากวางอย่างเดียวใช้ไม่ได้บน
 * โปรแกรมอ่านหน้าจอและบนแท็บเล็ตบางรุ่น
 */
export function PdfPageCard({
  page,
  index,
  total,
  sourceName,
  thumbnail,
  selected,
  previewUnavailable,
  onToggle,
  onRotate,
  onDuplicate,
  onDelete,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDropTarget,
}: PdfPageCardProps) {
  const position = index + 1;

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      data-testid="pdf-page-card"
      className={cn(
        'group relative flex w-[168px] shrink-0 flex-col gap-2 rounded-[10px] border bg-white p-2 shadow-card transition-[border-color,box-shadow] dark:bg-white/[.035]',
        selected
          ? 'border-primary-500 ring-2 ring-primary-500/25'
          : 'border-hairline hover:border-primary-300 dark:border-white/[.08]',
        isDropTarget && 'border-dashed border-primary-500',
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <label className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`เลือกหน้า ${position}`}
            className="h-3.5 w-3.5 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
          />
          หน้า {position}
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={actionButtonClass}
            aria-label={`ย้ายหน้า ${position} ไปก่อนหน้า`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={actionButtonClass}
            aria-label={`ย้ายหน้า ${position} ไปถัดไป`}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/*
        กรอบภาพย่อต้องสูงคงที่และเป็น flex ไม่ใช่ grid — ใน grid ที่แถวเป็น auto ค่า max-h-full
        ของภาพจะไปเทียบกับความสูงของแถวที่ยืดตามภาพเอง ภาพจึงไม่เคยถูกย่อ และหน้าที่ผู้ใช้หมุน 90°
        จะกว้างเกินการ์ดจนถูกตัดข้าง
      */}
      <div className="flex h-[150px] items-center justify-center overflow-hidden rounded-[8px] border border-hairline-row bg-slate-50 dark:border-white/[.07] dark:bg-slate-900/50">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={`ภาพย่อหน้า ${position} จาก ${sourceName}`}
            style={{ transform: `rotate(${page.rotation}deg)` }}
            className="max-h-full max-w-full object-contain transition-transform duration-150"
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-slate-400 dark:text-slate-500">
            <FileText className="h-6 w-6" aria-hidden="true" />
            <span className="text-[10px]">{previewUnavailable ? 'ไม่มีภาพย่อ' : 'กำลังสร้างภาพย่อ'}</span>
          </div>
        )}
      </div>

      <p className="truncate text-[10.5px] text-slate-500 dark:text-slate-400" title={sourceName}>
        {sourceName}
      </p>

      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={actionButtonClass}
            aria-label={`หมุนหน้า ${position} ทวนเข็มนาฬิกา`}
            onClick={() => onRotate(-90)}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={actionButtonClass}
            aria-label={`หมุนหน้า ${position} ตามเข็มนาฬิกา`}
            onClick={() => onRotate(90)}
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={actionButtonClass} aria-label={`ทำสำเนาหน้า ${position}`} onClick={onDuplicate}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={cn(actionButtonClass, 'hover:border-danger-300 hover:bg-danger-50 hover:text-danger-700')}
            aria-label={`ลบหน้า ${position}`}
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </li>
  );
}
