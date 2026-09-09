import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../services/apiClient';

/**
 * ปลายทาง Google Drive ถูกตั้งค่าไว้แล้วหรือยัง — ใช้ตัดสินว่าจะแสดงปุ่ม "ส่งไป Google Sheets" ไหม
 *
 * ค่านี้เปลี่ยนได้เฉพาะตอน deploy (เป็น secret ของ Worker) จึงถามครั้งเดียวต่อ session
 * ไม่ใช่ถามใหม่ทุกครั้งที่เปิดหน้าที่มีตารางส่งออก
 */
export function useGoogleDriveEnabled(): boolean {
  const query = useQuery({
    queryKey: ['google-drive', 'status'],
    queryFn: () => apiFetch<{ enabled: boolean }>('/api/v1/google-drive/status', undefined, { silent: true }),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  return query.data?.enabled === true;
}
