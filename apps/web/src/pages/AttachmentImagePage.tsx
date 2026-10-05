import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { apiFetch } from '../services/apiClient';
import { Button } from '../components/ui/Button';
import { PageTitle } from '../components/ui/PageTitle';

/** A durable document link; the API checks file access before issuing a fresh URL. */
export function AttachmentImagePage() {
  const { id } = useParams<{ id: string }>();
  const image = useQuery({
    queryKey: ['attachment-image', id],
    queryFn: () => apiFetch<{ url: string }>(`/api/v1/files/${encodeURIComponent(id!)}/signed-url`),
    enabled: Boolean(id),
    staleTime: 0,
    retry: false,
  });

  if (image.isPending) return <div role="status" className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /><span className="sr-only">กำลังโหลดรูปภาพ</span></div>;
  if (image.isError) return <div role="alert" className="space-y-3 p-6"><p>เปิดรูปภาพไม่ได้ กรุณาตรวจสอบสิทธิ์เข้าถึงหรือไฟล์อาจถูกลบแล้ว</p><Button onClick={() => void image.refetch()}>ลองอีกครั้ง</Button></div>;
  return <main className="space-y-4">
    <PageTitle eyebrow="งานบริการ / ไฟล์แนบ" title="รูปภาพแนบ" description="รูปภาพประกอบแบบฟอร์มแจ้งซ่อม" />
    <a className="text-primary-700 underline" href={image.data.url} target="_blank" rel="noopener noreferrer">เปิดรูปภาพขนาดเต็ม</a>
    <img className="mx-auto max-w-full rounded border bg-white" src={image.data.url} alt="รูปภาพแนบในแบบฟอร์มแจ้งซ่อม" />
  </main>;
}
