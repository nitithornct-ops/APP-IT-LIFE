import { useMutation } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { ApiError, apiFetch } from '../../services/apiClient';
import { downloadCsvText } from '../../utils/csv';
import { Button } from '../ui/Button';

interface ListExportResult {
  filename: string;
  csv: string;
  rowCount: number;
}

interface ExportAllButtonProps {
  /** endpoint ส่งออกพร้อม query string ของตัวกรองปัจจุบัน (เช่น /api/v1/tickets/export?status=...) */
  url: string;
  label?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * ส่งออกรายการ "ทั้งชุดตามตัวกรอง" โดยให้ server เป็นคนประกอบไฟล์
 *
 * ต่างจาก ExportCsvButton ที่ส่งออกเฉพาะหน้าที่เปิดอยู่ — ผู้ใช้ที่กรองไว้ 800 รายการแล้วกดส่งออก
 * คาดหวังไฟล์ 800 บรรทัด ไม่ใช่ 10 บรรทัดของหน้าแรก และจะไม่มีทางรู้เลยว่าได้ไฟล์ไม่ครบ
 *
 * เมื่อเกินเพดานของ server จะแสดงข้อความที่บอกจำนวนจริงกลับมา ผู้ใช้จะได้รู้ว่าต้องกรองแค่ไหน
 */
export function ExportAllButton({ url, label = 'ส่งออกทั้งหมด', disabled = false, className }: ExportAllButtonProps) {
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiFetch<ListExportResult>(url),
    onSuccess: (result) => {
      setError(null);
      downloadCsvText(result.csv, result.filename);
    },
    onError: (mutationError) => {
      setError(mutationError instanceof ApiError ? mutationError.message : 'ส่งออกไม่สำเร็จ');
    },
  });

  return (
    <span className={className}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        isLoading={mutation.isPending}
        onClick={() => { setError(null); mutation.mutate(); }}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {label}
      </Button>
      {error && <p className="mt-1 max-w-xs text-xs font-semibold text-red-600 dark:text-red-300" role="alert">{error}</p>}
    </span>
  );
}
