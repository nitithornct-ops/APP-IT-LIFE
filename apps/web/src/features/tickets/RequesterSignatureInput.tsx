import { Eraser, FileSignature, Upload } from 'lucide-react';
import { useRef, useState, type PointerEvent } from 'react';
import { Button } from '../../components/ui/Button';

const SIGNATURE_WIDTH = 900;
const SIGNATURE_HEIGHT = 260;

function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent<HTMLCanvasElement>) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

export function RequesterSignatureInput({
  onChange,
  disabled = false,
}: {
  onChange: (file: File | null) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const drawingRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);

  const publishCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) onChange(new File([blob], 'requester-signature.png', { type: 'image/png' }));
    }, 'image/png');
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setHasSignature(false);
    onChange(null);
  };

  const startDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const canvas = event.currentTarget;
    const context = canvas.getContext('2d');
    if (!context) return;
    canvas.setPointerCapture(event.pointerId);
    const point = canvasPoint(canvas, event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineWidth = 4;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#0f172a';
    drawingRef.current = true;
  };

  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || disabled) return;
    const canvas = event.currentTarget;
    const context = canvas.getContext('2d');
    if (!context) return;
    const point = canvasPoint(canvas, event);
    context.lineTo(point.x, point.y);
    context.stroke();
    setHasSignature(true);
  };

  const finishDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    publishCanvas();
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <FileSignature className="h-4 w-4 text-primary-600" aria-hidden="true" />
            ลายเซ็นผู้แจ้ง
          </p>
          <p className="mt-0.5 text-xs text-slate-500">เซ็นในกรอบ หรืออัปโหลดไฟล์ PNG (ไม่บังคับ)</p>
        </div>
        {hasSignature && (
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={clear}>
            <Eraser className="h-4 w-4" aria-hidden="true" /> ล้างลายเซ็น
          </Button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        width={SIGNATURE_WIDTH}
        height={SIGNATURE_HEIGHT}
        aria-label="พื้นที่เขียนลายเซ็นผู้แจ้ง"
        className="h-36 w-full touch-none rounded-lg border border-dashed border-slate-300 bg-white dark:border-slate-600"
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={finishDrawing}
        onPointerCancel={finishDrawing}
      />
      <div className="mt-2 flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png"
          aria-label="ไฟล์ลายเซ็นผู้แจ้ง PNG"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            setHasSignature(Boolean(file));
            onChange(file);
          }}
        />
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-4 w-4" aria-hidden="true" /> อัปโหลด PNG
        </Button>
        <span className="text-xs text-slate-400">ขนาดไม่เกิน 2 MB</span>
      </div>
    </div>
  );
}
