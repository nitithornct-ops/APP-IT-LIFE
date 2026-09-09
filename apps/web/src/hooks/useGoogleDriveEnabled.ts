import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../services/apiClient';

/**
 * แสดงปุ่ม "ส่งไป Google Sheets" ได้หรือยัง — ต้องจริงทั้งสองข้อ คือปลายทาง Google Drive ถูกตั้งค่า
 * ไว้แล้ว และผู้ใช้คนนี้มีสิทธิ์ส่งข้อมูลออกนอกระบบ (report.export) ปุ่มที่ขึ้นให้คนที่ไม่มีสิทธิ์กด
 * มีค่าเท่ากับปุ่มที่กดแล้วขึ้น 403 ทุกครั้ง
 *
 * ค่านี้เปลี่ยนได้เฉพาะตอน deploy (เป็น secret ของ Worker) และตามสิทธิ์ของผู้ใช้ที่ล็อกอินอยู่
 * จึงถามครั้งเดียวต่อ session ไม่ใช่ถามใหม่ทุกครั้งที่เปิดหน้าที่มีตารางส่งออก
 */
export function useGoogleDriveEnabled(): boolean {
  const query = useQuery({
    queryKey: ['google-drive', 'status'],
    queryFn: () => apiFetch<{ enabled: boolean; canExport: boolean }>('/api/v1/google-drive/status', undefined, { silent: true }),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  return query.data?.enabled === true && query.data?.canExport === true;
}
