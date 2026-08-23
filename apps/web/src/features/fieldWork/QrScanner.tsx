import { Camera, CameraOff, Keyboard, Loader2, ScanLine } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';

/**
 * ตัวสแกน QR ทรัพย์สินสำหรับหน้างาน
 *
 * ใช้ BarcodeDetector ของเบราว์เซอร์แทนการเพิ่ม library สแกน — รองรับบน Chrome/Edge บน Android
 * ซึ่งเป็นเครื่องที่ช่างใช้จริง และไม่เพิ่มโค้ดของบุคคลที่สามเข้ามาในเส้นทางที่เข้าถึงกล้อง
 *
 * เครื่องที่ไม่รองรับ (เช่น Safari บน iOS) หรือผู้ใช้ที่ไม่อนุญาตให้ใช้กล้อง ยังทำงานต่อได้ด้วยการ
 * พิมพ์รหัสเอง ช่องพิมพ์จึงแสดงอยู่เสมอ ไม่ใช่โผล่มาเฉพาะตอนกล้องพัง — หน้างานที่กล้องใช้ไม่ได้
 * แล้วทำอะไรต่อไม่ได้เลยคือหน้าจอที่ใช้งานจริงไม่ได้
 */

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

type CameraState = 'idle' | 'starting' | 'scanning' | 'unsupported' | 'denied' | 'error';

function barcodeDetectorCtor(): BarcodeDetectorConstructor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

function cameraSupported(): boolean {
  return Boolean(barcodeDetectorCtor() && navigator.mediaDevices?.getUserMedia);
}

const SCAN_INTERVAL_MS = 400;

export function QrScanner({ onDetected, busy = false }: { onDetected: (raw: string) => void; busy?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [manualCode, setManualCode] = useState('');

  const stopCamera = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // ปล่อยกล้องเสมอเมื่อออกจากหน้า มิฉะนั้นไฟกล้องจะค้างติดอยู่หลังช่างกดออกไปทำงานต่อ
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = useCallback(async () => {
    if (!cameraSupported()) {
      setCameraState('unsupported');
      return;
    }
    setCameraState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stopCamera();
        setCameraState('error');
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      const Detector = barcodeDetectorCtor();
      if (!Detector) {
        stopCamera();
        setCameraState('unsupported');
        return;
      }
      const detector = new Detector({ formats: ['qr_code'] });
      setCameraState('scanning');

      timerRef.current = window.setInterval(async () => {
        const element = videoRef.current;
        if (!element || element.readyState < 2) return;
        try {
          const results = await detector.detect(element);
          const value = results[0]?.rawValue?.trim();
          if (value) {
            stopCamera();
            setCameraState('idle');
            onDetected(value);
          }
        } catch {
          // เฟรมที่อ่านไม่ออกเป็นเรื่องปกติระหว่างเล็งกล้อง ไม่ใช่ความผิดพลาดที่ต้องหยุดสแกน
        }
      }, SCAN_INTERVAL_MS);
    } catch (error) {
      stopCamera();
      setCameraState((error as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'error');
    }
  }, [onDetected, stopCamera]);

  const submitManual = () => {
    const value = manualCode.trim();
    if (!value) return;
    onDetected(value);
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-[12px] border border-hairline bg-[#0B1B36] dark:border-white/[.08]">
        <div className="relative aspect-[4/3] w-full">
          <video
            ref={videoRef}
            className={`h-full w-full object-cover ${cameraState === 'scanning' ? '' : 'invisible'}`}
            muted
            playsInline
            aria-label="ภาพจากกล้องสำหรับสแกน QR"
          />
          {cameraState === 'scanning' && (
            <span className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
              <span className="h-40 w-40 rounded-[14px] border-2 border-white/80 shadow-[0_0_0_9999px_rgba(11,27,54,0.45)]" />
            </span>
          )}
          {cameraState !== 'scanning' && (
            <div className="absolute inset-0 grid place-items-center px-6 text-center">
              <div className="space-y-2">
                {cameraState === 'starting' ? (
                  <Loader2 className="mx-auto h-7 w-7 animate-spin text-white/70" aria-hidden="true" />
                ) : cameraState === 'idle' ? (
                  <Camera className="mx-auto h-7 w-7 text-white/70" aria-hidden="true" />
                ) : (
                  <CameraOff className="mx-auto h-7 w-7 text-white/70" aria-hidden="true" />
                )}
                <p className="text-[12px] leading-5 text-white/75">
                  {cameraState === 'idle' && 'เล็งกล้องไปที่ QR บนตัวเครื่อง หรือพิมพ์รหัสด้านล่าง'}
                  {cameraState === 'starting' && 'กำลังเปิดกล้อง...'}
                  {cameraState === 'unsupported' && 'เบราว์เซอร์นี้สแกน QR ในหน้าเว็บไม่ได้ กรุณาพิมพ์รหัสด้านล่าง'}
                  {cameraState === 'denied' && 'ยังไม่ได้อนุญาตให้ใช้กล้อง เปิดสิทธิ์กล้องในเบราว์เซอร์ หรือพิมพ์รหัสด้านล่าง'}
                  {cameraState === 'error' && 'เปิดกล้องไม่สำเร็จ กรุณาลองใหม่ หรือพิมพ์รหัสด้านล่าง'}
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-white/10 p-2.5">
          {cameraState === 'scanning' ? (
            <Button variant="outline" className="w-full" onClick={() => { stopCamera(); setCameraState('idle'); }}>
              <CameraOff className="h-4 w-4" aria-hidden="true" />หยุดสแกน
            </Button>
          ) : (
            <Button className="w-full" onClick={() => void startCamera()} disabled={busy || cameraState === 'starting'}>
              <ScanLine className="h-4 w-4" aria-hidden="true" />
              {cameraState === 'idle' ? 'เปิดกล้องสแกน QR' : 'ลองเปิดกล้องอีกครั้ง'}
            </Button>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="field-asset-code" className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">
          <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />พิมพ์รหัสทรัพย์สินเอง
        </label>
        <div className="flex gap-2">
          <input
            id="field-asset-code"
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitManual(); } }}
            placeholder="เช่น AS-NB-2608ABC"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-11 w-full rounded-[8px] border border-hairline-control px-3 font-mono text-[13px] text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-white/[.12] dark:bg-white/[.04] dark:text-slate-100"
          />
          <Button variant="outline" onClick={submitManual} disabled={busy || !manualCode.trim()}>ค้นหา</Button>
        </div>
      </div>
    </div>
  );
}
