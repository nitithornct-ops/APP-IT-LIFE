import { Download } from 'lucide-react';
import { Button } from '../ui/Button';
import { downloadCsv } from '../../utils/csv';

interface ExportCsvButtonProps {
  /** คืนทุกแถวตอนกดเท่านั้น (แถวแรกคือหัวตาราง) จะได้ไม่ต้องสร้างข้อมูลใหม่ทุกรอบ render */
  getRows: () => (readonly unknown[])[];
  fileName: string;
  disabled?: boolean;
  label?: string;
  className?: string;
}

/**
 * ปุ่มส่งออก CSV ของ "หน้าปัจจุบัน" สำหรับตารางที่ใช้ DataTable mode="server"
 * — ตารางไม่มีปุ่มในตัวให้แล้ว เพราะ toolbar ในตัวเห็นแค่แถวของหน้าปัจจุบัน
 *   จึงต้องให้หน้าเป็นคนบอกเองว่าคอลัมน์ไหนคือข้อมูลจริง (ไม่ใช่ข้อความในปุ่ม/Badge)
 */
export function ExportCsvButton({ getRows, fileName, disabled = false, label = 'ส่งออก CSV', className }: ExportCsvButtonProps) {
  return (
    <Button type="button" variant="outline" size="sm" className={className} disabled={disabled} onClick={() => downloadCsv(getRows(), fileName)}>
      <Download className="h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
