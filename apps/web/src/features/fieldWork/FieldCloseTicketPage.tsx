import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Camera, CheckCircle2, Package, Trash2, Wrench, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { LoadingState } from '../../components/ui/AsyncState';
import { PageHeader } from '../../components/ui/PageHeader';
import { QueryError } from '../../components/ui/QueryError';
import { ApiError, apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { InventoryItem } from '../../types/assets';
import type { PaginatedResult } from '../../types/admin';
import type { FieldCloseTicket, FieldOutcome, PartUsage } from '../../types/fieldWork';

/**
 * จอ 2 ของ Mobile Field Workflow (design handoff 3j) — ปิดงานตั้งแต่ยังยืนอยู่หน้าเครื่อง
 *
 * ตัวเลือก "ผลการแก้ไข" มาจาก state machine ของ API (field_outcomes) ไม่ใช่รายการที่หน้าจอคิดเอง
 * อะไหล่ที่เลือกจะตัดสต็อกจริงและผูกกับใบงานนี้ ส่วนรูปหน้างานอัปโหลดเข้าไฟล์แนบของใบงานเดียวกัน
 *
 * ลำดับการบันทึกสำคัญ: ตัดอะไหล่และแนบรูปให้เสร็จก่อน แล้วจึงเปลี่ยนสถานะเป็นขั้นสุดท้าย ถ้าขั้นใด
 * ล้มเหลวจะหยุดและบอกตรง ๆ ว่าอะไรบันทึกไปแล้วบ้าง ดีกว่าปิดงานสำเร็จแต่ของหายไปจากคลังโดยไม่มีบันทึก
 */
export function FieldCloseTicketPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  const [outcome, setOutcome] = useState<string>('');
  const [resolution, setResolution] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [outsourceName, setOutsourceName] = useState('');
  const [parts, setParts] = useState<PartUsage[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [partSearch, setPartSearch] = useState('');
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canManageInventory = hasPermission('inventory.manage');

  const ticketQuery = useQuery({
    queryKey: ['tickets', id, 'field-close'],
    queryFn: () => apiFetch<FieldCloseTicket>(`/api/v1/tickets/${id}`),
    enabled: Boolean(id),
  });

  const partsQuery = useQuery({
    queryKey: ['inventory-items', 'field', partSearch],
    queryFn: () =>
      apiFetch<PaginatedResult<InventoryItem>>(
        `/api/v1/inventory-items?pageSize=10&status=active${partSearch ? `&search=${encodeURIComponent(partSearch)}` : ''}`,
      ),
    enabled: canManageInventory && partSearch.trim().length >= 2,
  });

  const outcomes = useMemo(() => ticketQuery.data?.field_outcomes ?? [], [ticketQuery.data]);
  const selected = useMemo(() => outcomes.find((item) => item.status === outcome) ?? null, [outcomes, outcome]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!selected) throw new ApiError('VALIDATION_ERROR', 'กรุณาเลือกผลการแก้ไขก่อน');
      if (selected.requiresResolution && !resolution.trim()) {
        throw new ApiError('VALIDATION_ERROR', 'กรุณาบันทึกสิ่งที่ทำไปก่อนปิดงาน');
      }
      if (selected.status === 'ส่งต่อ Outsource' && !outsourceName.trim()) {
        throw new ApiError('VALIDATION_ERROR', 'กรุณาระบุผู้ให้บริการที่รับงานต่อ');
      }
      setProgress([]);

      // 1) ตัดสต็อกก่อน เพราะเป็นขั้นที่ย้อนกลับยากที่สุดถ้าปิดงานไปแล้วค่อยพบว่าของไม่พอ
      for (const part of parts) {
        if (part.qty <= 0) continue;
        await apiFetch(`/api/v1/inventory-items/${part.itemId}/transactions`, {
          method: 'POST',
          body: JSON.stringify({
            transactionType: 'OUT',
            qty: part.qty,
            ticketId: id,
            notes: `ใช้กับใบงาน ${ticketQuery.data?.ticket_no ?? id}`,
          }),
        });
        setProgress((current) => [...current, `ตัดสต็อก ${part.itemName} ${part.qty} ${part.unit}`]);
      }

      // 2) แนบรูปหน้างาน
      for (const photo of photos) {
        const form = new FormData();
        form.append('file', photo);
        form.append('module', 'ticket');
        form.append('targetTable', 'tickets');
        form.append('targetId', id);
        await apiFetch('/api/v1/files', { method: 'POST', body: form });
        setProgress((current) => [...current, `แนบรูป ${photo.name}`]);
      }

      // 3) เปลี่ยนสถานะเป็นขั้นสุดท้าย — ขั้นนี้เป็นตัวส่งแจ้งเตือนถึงผู้แจ้งฝั่ง API
      await apiFetch(`/api/v1/tickets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: selected.status,
          resolution: resolution.trim() || undefined,
          rootCause: rootCause.trim() || undefined,
          outsourceName: selected.status === 'ส่งต่อ Outsource' ? outsourceName.trim() : undefined,
        }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      navigate(`/tickets/${id}`);
    },
    onError: (reason: unknown) => {
      setError(reason instanceof ApiError || reason instanceof Error ? reason.message : 'บันทึกงานหน้างานไม่สำเร็จ');
    },
  });

  if (ticketQuery.isLoading) return <LoadingState label="กำลังโหลดใบงาน" rows={5} />;
  if (ticketQuery.isError || !ticketQuery.data) {
    return <QueryError error={ticketQuery.error} title="โหลดใบงานไม่สำเร็จ" onRetry={() => void ticketQuery.refetch()} isRetrying={ticketQuery.isFetching} />;
  }

  const ticket = ticketQuery.data;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-24">
      <PageHeader
        eyebrow={`หน้างาน / ${ticket.ticket_no}`}
        title="ปิดงานหน้างาน"
        description={ticket.title}
        leading={<Wrench className="h-4 w-4" aria-hidden="true" />}
        meta={<Badge variant="secondary">สถานะปัจจุบัน: {ticket.status}</Badge>}
      />

      {outcomes.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-[12.5px] leading-5 text-slate-600 dark:text-slate-300">
              ใบงานนี้อยู่ในสถานะ “{ticket.status}” ซึ่งบันทึกผลหน้างานต่อไม่ได้แล้ว
              {' '}เปิดหน้ารายละเอียดใบงานเพื่อดูขั้นตอนที่ทำได้
            </p>
            <Button className="mt-3" variant="outline" onClick={() => navigate(`/tickets/${id}`)}>เปิดรายละเอียดใบงาน</Button>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-primary-600" aria-hidden="true" />ผลการแก้ไข</CardHeader>
            <CardBody className="space-y-2" role="radiogroup" aria-label="ผลการแก้ไข">
              {outcomes.map((item) => (
                <OutcomeCard key={item.status} outcome={item} selected={outcome === item.status} onSelect={() => setOutcome(item.status)} />
              ))}
            </CardBody>
          </Card>

          {selected?.status === 'ส่งต่อ Outsource' && (
            <Card>
              <CardHeader>ผู้ให้บริการที่รับงานต่อ</CardHeader>
              <CardBody>
                <input
                  value={outsourceName}
                  onChange={(event) => setOutsourceName(event.target.value)}
                  placeholder="ชื่อผู้ให้บริการ"
                  aria-label="ชื่อผู้ให้บริการที่รับงานต่อ"
                  className="min-h-11 w-full rounded-[8px] border border-hairline-control px-3 text-[13px] focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-white/[.12] dark:bg-white/[.04] dark:text-slate-100"
                />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>บันทึกงาน</CardHeader>
            <CardBody className="space-y-3">
              <div>
                <label htmlFor="field-resolution" className="mb-1 block text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">
                  สิ่งที่ทำไป {selected?.requiresResolution && <span className="text-danger-600">*</span>}
                </label>
                <textarea
                  id="field-resolution"
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="เช่น เปลี่ยนสาย HDMI และทดสอบภาพจนใช้งานได้ปกติ"
                  className="w-full rounded-[8px] border border-hairline-control px-3 py-2 text-[13px] focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-white/[.12] dark:bg-white/[.04] dark:text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="field-root-cause" className="mb-1 block text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">สาเหตุที่แท้จริง</label>
                <input
                  id="field-root-cause"
                  value={rootCause}
                  onChange={(event) => setRootCause(event.target.value)}
                  maxLength={500}
                  placeholder="เช่น สายสัญญาณเสื่อมสภาพจากการถอดเสียบบ่อย"
                  className="min-h-11 w-full rounded-[8px] border border-hairline-control px-3 text-[13px] focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-white/[.12] dark:bg-white/[.04] dark:text-slate-100"
                />
                <p className="mt-1 text-[10.5px] text-slate-400 dark:text-slate-500">
                  ระบบยังไม่มีทะเบียนสาเหตุมาตรฐานให้เลือกเป็นชิป จึงบันทึกเป็นข้อความไว้ในใบงานตามจริง
                </p>
              </div>
            </CardBody>
          </Card>

          <PartsPanel
            canManageInventory={canManageInventory}
            parts={parts}
            setParts={setParts}
            partSearch={partSearch}
            setPartSearch={setPartSearch}
            results={partsQuery.data?.items ?? []}
            searching={partsQuery.isFetching}
          />

          <PhotoPanel photos={photos} setPhotos={setPhotos} />

          {progress.length > 0 && (
            <ul className="rounded-[8px] border border-hairline bg-slate-50 px-3 py-2.5 text-[11.5px] text-slate-600 dark:border-white/[.08] dark:bg-white/[.03] dark:text-slate-300">
              {progress.map((line) => <li key={line}>✓ {line}</li>)}
            </ul>
          )}

          {error && (
            <p className="flex items-start gap-2 rounded-[8px] border border-danger-100 bg-danger-50 px-3 py-2.5 text-[12px] leading-5 text-danger-700 dark:border-danger-700 dark:bg-danger-700/20 dark:text-danger-100" role="alert">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{error}{progress.length > 0 && ' — รายการที่ทำสำเร็จไปแล้วด้านบนถูกบันทึกไว้แล้ว ไม่ต้องทำซ้ำ'}</span>
            </p>
          )}

          <div className="sticky bottom-2">
            <Button
              variant="success"
              className="min-h-[52px] w-full text-[15px]"
              disabled={!outcome}
              isLoading={submit.isPending}
              onClick={() => { setError(null); submit.mutate(); }}
            >
              บันทึกและแจ้งผู้ใช้
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function OutcomeCard({ outcome, selected, onSelect }: { outcome: FieldOutcome; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full min-h-[56px] items-start gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
        selected
          ? 'border-primary-500 bg-primary-50 dark:border-primary-500 dark:bg-primary-900/30'
          : 'border-hairline hover:border-primary-300 dark:border-white/[.08]'
      }`}
    >
      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${selected ? 'border-primary-600' : 'border-slate-300 dark:border-slate-600'}`}>
        {selected && <span className="h-2 w-2 rounded-full bg-primary-600" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-bold text-ink-heading dark:text-slate-100">{outcome.label}</span>
        <span className="mt-0.5 block text-[11.5px] leading-4 text-slate-500 dark:text-slate-400">{outcome.description}</span>
      </span>
    </button>
  );
}

function PartsPanel({
  canManageInventory, parts, setParts, partSearch, setPartSearch, results, searching,
}: {
  canManageInventory: boolean;
  parts: PartUsage[];
  setParts: (updater: (current: PartUsage[]) => PartUsage[]) => void;
  partSearch: string;
  setPartSearch: (value: string) => void;
  results: InventoryItem[];
  searching: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex items-center gap-2"><Package className="h-4 w-4 text-primary-600" aria-hidden="true" />อะไหล่ที่ใช้</CardHeader>
      <CardBody className="space-y-3">
        {!canManageInventory ? (
          <p className="text-[11.5px] leading-5 text-slate-500 dark:text-slate-400">
            ต้องมีสิทธิ์จัดการคลัง (inventory.manage) จึงจะตัดสต็อกอะไหล่จากหน้านี้ได้
          </p>
        ) : (
          <>
            {parts.map((part) => (
              <div key={part.itemId} className="flex items-center gap-2 rounded-[8px] border border-hairline px-3 py-2 dark:border-white/[.08]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-ink-heading dark:text-slate-100">{part.itemName}</span>
                  <span className="block text-[10.5px] text-slate-400">คงเหลือ {part.stockQty} {part.unit}</span>
                </span>
                <input
                  type="number"
                  min={1}
                  max={part.stockQty}
                  value={part.qty}
                  aria-label={`จำนวน ${part.itemName}`}
                  onChange={(event) => {
                    const qty = Number(event.target.value);
                    setParts((current) => current.map((item) => item.itemId === part.itemId ? { ...item, qty } : item));
                  }}
                  className="min-h-10 w-16 rounded-[7px] border border-hairline-control px-2 text-center font-mono text-[13px] dark:border-white/[.12] dark:bg-white/[.04] dark:text-slate-100"
                />
                <button
                  type="button"
                  aria-label={`เอา ${part.itemName} ออก`}
                  onClick={() => setParts((current) => current.filter((item) => item.itemId !== part.itemId))}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-[7px] text-slate-400 hover:bg-danger-50 hover:text-danger-700"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}

            <div>
              <label htmlFor="field-part-search" className="mb-1 block text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">ค้นหาอะไหล่จากคลัง</label>
              <input
                id="field-part-search"
                value={partSearch}
                onChange={(event) => setPartSearch(event.target.value)}
                placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร"
                className="min-h-11 w-full rounded-[8px] border border-hairline-control px-3 text-[13px] focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-white/[.12] dark:bg-white/[.04] dark:text-slate-100"
              />
            </div>

            {searching && <p className="text-[11.5px] text-slate-400" role="status">กำลังค้นหา...</p>}
            {partSearch.trim().length >= 2 && !searching && results.length === 0 && (
              <p className="text-[11.5px] text-slate-400">ไม่พบอะไหล่ที่ตรงกับคำค้นนี้ในคลัง</p>
            )}
            <ul className="space-y-1">
              {results
                .filter((item) => !parts.some((part) => part.itemId === item.id))
                .map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={item.stock_qty <= 0}
                      onClick={() => setParts((current) => [...current, { itemId: item.id, itemName: item.item_name, unit: item.unit, stockQty: item.stock_qty, qty: 1 }])}
                      className="flex w-full min-h-10 items-center justify-between gap-2 rounded-[7px] border border-hairline px-3 text-left text-[12px] hover:border-primary-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.08]"
                    >
                      <span className="min-w-0 truncate font-semibold text-ink-heading dark:text-slate-100">{item.item_name}</span>
                      <span className="shrink-0 font-mono text-[10.5px] text-slate-400">
                        {item.stock_qty <= 0 ? 'ของหมด' : `เหลือ ${item.stock_qty} ${item.unit}`}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function PhotoPanel({ photos, setPhotos }: { photos: File[]; setPhotos: (updater: (current: File[]) => File[]) => void }) {
  return (
    <Card>
      <CardHeader className="flex items-center gap-2"><Camera className="h-4 w-4 text-primary-600" aria-hidden="true" />รูปหน้างาน</CardHeader>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {photos.map((photo, index) => (
            <span key={`${photo.name}-${index}`} className="relative">
              <img src={URL.createObjectURL(photo)} alt={photo.name} className="h-[62px] w-[62px] rounded-[8px] object-cover" />
              <button
                type="button"
                aria-label={`ลบรูป ${photo.name}`}
                onClick={() => setPhotos((current) => current.filter((_, position) => position !== index))}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-slate-900/85 text-white"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          <label className="grid h-[62px] w-[62px] cursor-pointer place-items-center rounded-[8px] border border-dashed border-hairline-control text-slate-400 hover:border-primary-400 dark:border-white/[.16]">
            <Camera className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">เพิ่มรูปหน้างาน</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                setPhotos((current) => [...current, ...files]);
                event.target.value = '';
              }}
            />
          </label>
        </div>
        <p className="text-[10.5px] text-slate-400 dark:text-slate-500">รูปจะถูกแนบเข้ากับใบงานนี้ ขนาดไฟล์ละไม่เกิน 10 MB ตามข้อกำหนดของระบบไฟล์แนบ</p>
      </CardBody>
    </Card>
  );
}
