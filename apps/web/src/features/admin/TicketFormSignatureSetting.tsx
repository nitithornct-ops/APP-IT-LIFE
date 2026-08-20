import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSignature, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ApiError, apiFetch } from '../../services/apiClient';
import { formatThaiDate } from '../../utils/date';

interface FormSignature { signatureUrl: string | null; uploadedAt: string | null }
const MAX_BYTES = 2 * 1024 * 1024;

export function TicketFormSignatureSetting({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState('');
  const query = useQuery({ queryKey: ['admin', 'ticket-form-signature'], queryFn: () => apiFetch<FormSignature>('/api/v1/settings/ticket-form-signature') });
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : query.data?.signatureUrl ?? null, [file, query.data?.signatureUrl]);
  useEffect(() => () => { if (file && previewUrl && previewUrl !== query.data?.signatureUrl) URL.revokeObjectURL(previewUrl); }, [file, previewUrl, query.data?.signatureUrl]);
  const refresh = async () => { setFile(null); if (inputRef.current) inputRef.current.value = ''; await Promise.all([queryClient.invalidateQueries({ queryKey: ['admin', 'ticket-form-signature'] }), queryClient.invalidateQueries({ queryKey: ['tickets'] })]); };
  const upload = useMutation({ mutationFn: async (selected: File) => { const body = new FormData(); body.set('file', selected); return apiFetch<FormSignature>('/api/v1/settings/ticket-form-signature', { method: 'POST', body }); }, onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => apiFetch<FormSignature>('/api/v1/settings/ticket-form-signature', { method: 'DELETE' }), onSuccess: refresh });
  const choose = (selected?: File) => {
    setValidationError('');
    if (!selected) return setFile(null);
    if (selected.type !== 'image/png') return setValidationError('รองรับเฉพาะไฟล์ PNG เท่านั้น');
    if (selected.size > MAX_BYTES) return setValidationError('ไฟล์ลายเซ็นต้องมีขนาดไม่เกิน 2 MB');
    setFile(selected);
  };
  const failure = upload.error ?? remove.error ?? query.error;
  const message = validationError || (failure instanceof ApiError || failure instanceof Error ? failure.message : '');

  return <Card data-testid="ticket-form-signature-setting">
    <CardHeader className="flex items-center gap-2"><FileSignature className="h-5 w-5 text-primary-600" />ลายเซ็นกลางสำหรับแบบฟอร์ม Ticket</CardHeader>
    <CardBody>
      <p className="mb-3 text-sm text-slate-500">ตั้งค่าเพียงครั้งเดียว ระบบจะแสดงลายเซ็นนี้อัตโนมัติในทุก Ticket ที่ไม่ได้กำหนดลายเซ็นเฉพาะใบ</p>
      <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-4 dark:border-slate-600 dark:bg-slate-900">
        {previewUrl ? <img src={previewUrl} alt="ลายเซ็นกลางสำหรับแบบฟอร์ม Ticket" className="max-h-28 max-w-full object-contain" /> : <div className="text-center text-slate-400"><ImageIcon className="mx-auto h-9 w-9" /><p className="mt-2 text-xs">ยังไม่ได้ตั้งลายเซ็นกลาง</p></div>}
      </div>
      {query.data?.uploadedAt && !file && <p className="mt-2 text-xs text-slate-400">อัปโหลดเมื่อ {formatThaiDate(query.data.uploadedAt, 'd MMM yyyy HH:mm')}</p>}
      {message && <p role="alert" className="mt-2 text-xs font-semibold text-red-600">{message}</p>}
      {canManage && <div className="mt-3 flex flex-wrap gap-2">
        <input ref={inputRef} aria-label="ไฟล์ลายเซ็นกลาง PNG" type="file" accept="image/png" className="sr-only" onChange={(event) => choose(event.target.files?.[0])} />
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}><ImageIcon className="h-4 w-4" />เลือก PNG</Button>
        {file && <Button size="sm" isLoading={upload.isPending} onClick={() => upload.mutate(file)}><Upload className="h-4 w-4" />บันทึกลายเซ็นกลาง</Button>}
        {query.data?.signatureUrl && !file && <Button size="sm" variant="danger" isLoading={remove.isPending} onClick={() => remove.mutate()}><Trash2 className="h-4 w-4" />ลบลายเซ็นกลาง</Button>}
      </div>}
    </CardBody>
  </Card>;
}
