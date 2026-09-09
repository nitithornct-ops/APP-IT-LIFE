import { useMutation } from '@tanstack/react-query';
import { ExternalLink, FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { useGoogleDriveEnabled } from '../../hooks/useGoogleDriveEnabled';
import { ApiError, apiFetch, showToast } from '../../services/apiClient';
import { Button } from '../ui/Button';

interface SheetExport {
  csv: string;
  fileName: string;
}

interface DriveFile {
  id: string;
  name: string;
  webViewLink: string;
}

interface ExportSheetsButtonProps {
  /** คืน CSV ตอนกดเท่านั้น — เป็น async ได้ เพราะบางปุ่มต้องไปดึงข้อมูลทั้งชุดจาก server ก่อน */
  getExport: () => SheetExport | Promise<SheetExport>;
  disabled?: boolean;
  label?: string;
}

/**
 * ส่งข้อมูลชุดเดียวกับที่ปุ่มส่งออก CSV ใช้ ขึ้นไปเป็น Google Sheets หนึ่งไฟล์
 *
 * ใช้ CSV ก้อนเดิมโดยตั้งใจ — ข้อมูลจึงตรงกับไฟล์ที่ดาวน์โหลดได้เสมอ ไม่ต้องมีเส้นทางดึงข้อมูล
 * เส้นที่สองที่ต้องคอยไล่ให้สิทธิ์ตรงกัน (ฝั่ง Worker อธิบายไว้ที่ routes/googleDrive.ts)
 *
 * ไม่แสดงอะไรเลยเมื่อยังไม่ได้ตั้งค่าปลายทาง Drive และหลังส่งสำเร็จจะแสดง "ลิงก์" ให้กดเปิดเอง
 * แทนการเปิดแท็บใหม่ให้อัตโนมัติ เพราะเบราว์เซอร์บล็อกการเปิดแท็บที่เกิดหลัง await เป็นปกติ
 */
export function ExportSheetsButton({ getExport, disabled = false, label = 'ส่งไป Google Sheets' }: ExportSheetsButtonProps) {
  const enabled = useGoogleDriveEnabled();
  const [file, setFile] = useState<DriveFile | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const { csv, fileName } = await getExport();
      return apiFetch<DriveFile>('/api/v1/google-drive/sheets', {
        method: 'POST',
        body: JSON.stringify({ filename: fileName, csv }),
      }, { silent: true });
    },
    onSuccess: (created) => {
      setFile(created);
      showToast('success', `สร้าง Google Sheets "${created.name}" เรียบร้อยแล้ว`);
    },
    onError: (error) => {
      setFile(null);
      showToast('error', error instanceof ApiError ? error.message : 'ส่งไป Google Sheets ไม่สำเร็จ');
    },
  });

  if (!enabled) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        isLoading={mutation.isPending}
        onClick={() => { setFile(null); mutation.mutate(); }}
      >
        <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
        {label}
      </Button>
      {file && (
        <a
          href={file.webViewLink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 underline dark:text-primary-300"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          เปิดใน Google Sheets
        </a>
      )}
    </>
  );
}
