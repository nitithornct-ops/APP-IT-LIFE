import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSignature, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ApiError, apiFetch } from '../../services/apiClient';
import { formatThaiDate } from '../../utils/date';

const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

function errorText(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : 'จัดการลายเซ็นไม่สำเร็จ';
}

export function TicketSignaturePanel({
  ticketId,
  signatureUrl,
  uploadedAt,
  canManage,
}: {
  ticketId: string;
  signatureUrl: string | null;
  uploadedAt: string | null;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState('');
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : signatureUrl, [file, signatureUrl]);

  useEffect(() => () => {
    if (file && previewUrl && previewUrl !== signatureUrl) URL.revokeObjectURL(previewUrl);
  }, [file, previewUrl, signatureUrl]);

  const refresh = async () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    await queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] });
  };
  const uploadMutation = useMutation({
    mutationFn: async (selected: File) => {
      const body = new FormData();
      body.set('file', selected);
      return apiFetch(`/api/v1/tickets/${ticketId}/signature`, { method: 'POST', body });
    },
    onSuccess: refresh,
  });
  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/tickets/${ticketId}/signature`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const selectFile = (selected: File | undefined) => {
    setValidationError('');
    if (!selected) return setFile(null);
    if (selected.type !== 'image/png') {
      setFile(null);
      return setValidationError('รองรับเฉพาะไฟล์ PNG เท่านั้น');
    }
    if (selected.size > MAX_SIGNATURE_BYTES) {
      setFile(null);
      return setValidationError('ไฟล์ลายเซ็นต้องมีขนาดไม่เกิน 2 MB');
    }
    setFile(selected);
  };
  const mutationError = uploadMutation.error ?? deleteMutation.error;

  if (!canManage && !signatureUrl) return null;

  return (
    <Card data-testid="ticket-signature-panel">
      <CardHeader className="flex items-center gap-2"><FileSignature className="h-5 w-5 text-primary-600" />ลายเซ็นรับรอง Ticket</CardHeader>
      <CardBody>
        <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-4 dark:border-slate-600 dark:bg-slate-900">
          {previewUrl
            ? <img src={previewUrl} alt="ลายเซ็นรับรอง Ticket" className="max-h-28 max-w-full object-contain" />
            : <div className="text-center text-slate-400"><ImageIcon className="mx-auto h-9 w-9" /><p className="mt-2 text-xs">ยังไม่มีลายเซ็น</p></div>}
        </div>
        {uploadedAt && !file && <p className="mt-1 text-xs text-slate-400">อัปโหลดเมื่อ {formatThaiDate(uploadedAt, 'd MMM yyyy HH:mm')}</p>}
        {(validationError || mutationError) && <p role="alert" className="mt-2 text-xs font-semibold text-red-600">{validationError || errorText(mutationError)}</p>}
        {canManage && <div className="mt-3 flex flex-wrap gap-2">
          <input ref={fileInputRef} aria-label="ไฟล์ลายเซ็น PNG" type="file" accept="image/png" className="sr-only" onChange={(event) => selectFile(event.target.files?.[0])} />
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}><ImageIcon className="h-4 w-4" />เลือก PNG</Button>
          {file && <Button size="sm" isLoading={uploadMutation.isPending} onClick={() => uploadMutation.mutate(file)}><Upload className="h-4 w-4" />บันทึกลายเซ็น</Button>}
          {signatureUrl && !file && <Button size="sm" variant="danger" isLoading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}><Trash2 className="h-4 w-4" />ลบลายเซ็น</Button>}
        </div>}
        {canManage && <p className="mt-2 text-xs text-slate-500">PNG ไม่เกิน 2 MB · ลายเซ็นผูกกับ Ticket ใบนี้ใบเดียว ไม่ตกทอดไปใบอื่น</p>}
      </CardBody>
    </Card>
  );
}
