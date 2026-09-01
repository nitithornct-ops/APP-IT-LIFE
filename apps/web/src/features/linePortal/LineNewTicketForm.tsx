import { ImagePlus, Loader2, Plus, QrCode, Send, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../services/apiClient';
import { lineApiFetch } from '../../services/lineApiClient';
import { cn } from '../../utils/cn';
import type { TicketPriority } from '../../types/tickets';
import { LineScreenHeader } from './LinePortalChrome';
import type { LinePortalProfile, LineTicketCategory } from './types';

const PRIORITIES: TicketPriority[] = ['ต่ำ', 'ปานกลาง', 'สูง', 'วิกฤต'];
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

const LABEL = 'mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300';
const INPUT = 'public-field w-full px-3 py-2.5 text-sm placeholder:text-slate-400 focus:outline-none';

function Required() {
  return <span className="text-danger-600" aria-hidden="true"> *</span>;
}

/** ชั่วโมงตอบรับตามหมวดหมู่ที่เลือก ใช้บอกผู้แจ้งว่าจะได้ยินข่าวกลับเมื่อไร */
function responseSlaHours(category: LineTicketCategory | undefined): number | null {
  if (!category) return null;
  const hours = category.response_sla_hours ?? category.resolution_sla_hours ?? category.sla_hours;
  return hours == null ? null : Number(hours);
}

export function LineNewTicketForm({ profile, categories, startWithAssetCode, onCancel, onSubmitted }: {
  profile: LinePortalProfile;
  categories: LineTicketCategory[];
  startWithAssetCode: boolean;
  onCancel: () => void;
  onSubmitted: (ticketId: string, warning?: string) => void;
}) {
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [requesterPhone, setRequesterPhone] = useState('');
  const [priority, setPriority] = useState<TicketPriority | ''>('');
  const [assetCode, setAssetCode] = useState('');
  const [showAssetCode, setShowAssetCode] = useState(startWithAssetCode);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const assetCodeRef = useRef<HTMLInputElement>(null);

  const selectedCategory = categories.find((category) => category.id === categoryId);
  const slaHours = responseSlaHours(selectedCategory);
  const previews = useMemo(
    () => attachments.map((file) => ({
      name: file.name,
      url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    })),
    [attachments],
  );

  useEffect(() => () => previews.forEach((preview) => preview.url && URL.revokeObjectURL(preview.url)), [previews]);
  useEffect(() => { if (startWithAssetCode) assetCodeRef.current?.focus(); }, [startWithAssetCode]);

  function selectFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (selected.length === 0) return;
    if (attachments.length + selected.length > MAX_ATTACHMENTS) {
      setError(`แนบได้สูงสุด ${MAX_ATTACHMENTS} ไฟล์ต่อ Ticket`);
      return;
    }
    const invalidType = selected.find((file) => !ATTACHMENT_TYPES.includes(file.type));
    if (invalidType) {
      setError(`ไฟล์ ${invalidType.name} ไม่รองรับ — เลือกได้เฉพาะ JPG, PNG, GIF, WebP หรือ PDF`);
      return;
    }
    const oversized = selected.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (oversized) {
      setError(`ไฟล์ ${oversized.name} มีขนาดเกิน 10 MB`);
      return;
    }
    setAttachments((current) => [...current, ...selected]);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const phone = requesterPhone.trim();
    if (phone && phone.length < 8) {
      setError('กรุณากรอกเบอร์ติดต่ออย่างน้อย 8 ตัวอักษร');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const ticket = await lineApiFetch<{ id: string }>('/api/v1/line/tickets', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          categoryId,
          description: description.trim(),
          priority: priority || undefined,
          location: location.trim() || undefined,
          requesterPhone: phone || undefined,
          assetCode: assetCode.trim() || undefined,
          department: profile.department || undefined,
          privacyConsent: true,
        }),
      });
      // ไฟล์แนบอัปโหลดหลังใบถูกสร้าง ไฟล์ที่ล้มเหลวจะไม่ทำให้ใบที่ส่งสำเร็จแล้วหายไป
      // แต่ส่งคำเตือนไปแสดงบนจอถัดไป ผู้แจ้งจะได้รู้ว่าต้องบอกทีม IT เรื่องไฟล์
      let failedUploads = 0;
      for (const file of attachments) {
        try {
          const body = new window.FormData();
          body.append('file', file);
          await lineApiFetch(`/api/v1/line/tickets/${ticket.id}/attachments`, { method: 'POST', body });
        } catch {
          failedUploads += 1;
        }
      }
      onSubmitted(
        ticket.id,
        failedUploads > 0
          ? `ส่ง Ticket สำเร็จ แต่แนบไฟล์ไม่สำเร็จ ${failedUploads} ไฟล์ — แจ้งทีม IT ผ่านกล่องข้อความในใบนี้เพื่อขอส่งไฟล์อีกครั้ง`
          : undefined,
      );
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : 'ส่ง Ticket ไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = Boolean(categoryId && title.trim() && description.trim() && privacyConsent) && !submitting;

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col pb-4" noValidate>
      <LineScreenHeader onBack={onCancel} eyebrow="แจ้งซ่อม / Ticket ใหม่" title={`ผู้แจ้ง: ${profile.fullName}`} />

      <div className="flex flex-col gap-4 px-4 pt-4">
        <fieldset>
          <legend className={LABEL}>หมวดหมู่ปัญหา<Required /></legend>
          {categories.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">ยังโหลดหมวดหมู่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => {
                    setCategoryId(category.id);
                    if (!priority && category.default_priority) setPriority(category.default_priority);
                  }}
                  aria-pressed={categoryId === category.id}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                    categoryId === category.id
                      ? 'border-primary-700 bg-primary-700 text-white'
                      : 'border-hairline bg-white text-slate-600 hover:border-primary-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                  )}
                >
                  {category.name}
                </button>
              ))}
            </div>
          )}
          {slaHours != null && (
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">ทีม IT จะตอบรับภายใน {slaHours} ชม. ตาม SLA ของหมวดหมู่นี้</p>
          )}
        </fieldset>

        <div>
          <label htmlFor="line-ticket-title" className={LABEL}>หัวข้ออาการ<Required /></label>
          <input
            id="line-ticket-title"
            className={INPUT}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            placeholder="เช่น โน้ตบุ๊กเปิดไม่ติด หน้าจอดำ"
            required
          />
        </div>

        <div>
          <label htmlFor="line-ticket-description" className={LABEL}>รายละเอียด<Required /></label>
          <textarea
            id="line-ticket-description"
            className={INPUT}
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={3000}
            placeholder="อาการที่พบ เริ่มเมื่อไร และสิ่งที่ลองแก้ไปแล้ว"
            required
          />
          <p className="mt-1 text-right text-[10px] text-slate-400">{description.length}/3000</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="line-ticket-location" className={LABEL}>สถานที่</label>
            <input
              id="line-ticket-location"
              className={INPUT}
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              maxLength={160}
              placeholder="อาคาร A ชั้น 3"
            />
          </div>
          <div>
            <label htmlFor="line-ticket-phone" className={LABEL}>เบอร์ติดต่อ</label>
            <input
              id="line-ticket-phone"
              className={INPUT}
              value={requesterPhone}
              onChange={(event) => setRequesterPhone(event.target.value)}
              maxLength={40}
              inputMode="tel"
              autoComplete="tel"
              placeholder="ต่อ 1204"
            />
          </div>
        </div>

        <fieldset>
          <legend className={LABEL}>ความเร่งด่วน</legend>
          <div className="grid grid-cols-4 gap-1.5">
            {PRIORITIES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPriority(option)}
                aria-pressed={priority === option}
                className={cn(
                  'rounded-card border py-2 text-xs font-semibold transition',
                  priority === option
                    ? 'border-primary-700 bg-primary-700 text-white'
                    : 'border-hairline bg-white text-slate-600 hover:border-primary-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                )}
              >
                {option}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            ไม่เลือกได้ ระบบจะใช้ระดับตามหมวดหมู่ที่ทีม IT ตั้งไว้
          </p>
        </fieldset>

        <fieldset>
          <legend className={LABEL}>ไฟล์แนบ (ไม่เกิน {MAX_ATTACHMENTS} ไฟล์ · 10 MB ต่อไฟล์)</legend>
          <div className="flex flex-wrap gap-2">
            {previews.map((preview, index) => (
              <span key={`${preview.name}-${index}`} className="relative h-16 w-16 overflow-hidden rounded-card border border-hairline bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                {preview.url
                  ? <img src={preview.url} alt={preview.name} className="h-full w-full object-cover" />
                  : <span className="flex h-full w-full items-center justify-center px-1 text-center text-[9px] leading-3 text-slate-500">{preview.name}</span>}
                <button
                  type="button"
                  onClick={() => setAttachments((current) => current.filter((_, position) => position !== index))}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900/70 text-white"
                  aria-label={`ลบไฟล์ ${preview.name}`}
                >
                  <X className="h-2.5 w-2.5" aria-hidden="true" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-card border border-dashed border-hairline text-slate-500 transition hover:border-primary-300 dark:border-slate-600 dark:text-slate-400"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="text-[9px] font-semibold">เพิ่มรูป</span>
            </button>
            <button
              type="button"
              onClick={() => { setShowAssetCode(true); window.setTimeout(() => assetCodeRef.current?.focus(), 0); }}
              className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-card border border-dashed border-primary-300 text-primary-700 transition hover:bg-primary-50 dark:border-primary-800 dark:text-primary-300"
            >
              <QrCode className="h-4 w-4" aria-hidden="true" />
              <span className="text-[9px] font-semibold">รหัสเครื่อง</span>
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            multiple
            accept={ATTACHMENT_TYPES.join(',')}
            onChange={selectFiles}
            aria-label="เลือกไฟล์แนบ"
          />
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" /> รูปหน้าจอหรือรูปอาการช่วยให้ทีม IT วินิจฉัยได้เร็วขึ้น
          </p>
        </fieldset>

        {showAssetCode && (
          <div>
            <label htmlFor="line-ticket-asset" className={LABEL}>รหัสทรัพย์สิน (ตามสติกเกอร์บนเครื่อง)</label>
            <input
              ref={assetCodeRef}
              id="line-ticket-asset"
              className={INPUT}
              value={assetCode}
              onChange={(event) => setAssetCode(event.target.value)}
              maxLength={80}
              placeholder="เช่น IT-NB-0142"
            />
          </div>
        )}

        <label className="flex items-start gap-2 text-[11px] leading-5 text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={privacyConsent}
            onChange={(event) => setPrivacyConsent(event.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>ยอมรับการใช้ข้อมูลเพื่อรับเรื่อง ติดต่อกลับ แจ้งสถานะ และเก็บหลักฐานการแจ้งซ่อมตามนโยบายขององค์กร<Required /></span>
        </label>

        {error && <p className="public-notice px-3 py-2 text-xs" role="alert">{error}</p>}

        <button type="submit" disabled={!canSubmit} className="public-primary-button flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-bold text-white">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />} ส่ง Ticket
        </button>
        <p className="text-center text-[11px] text-slate-500 dark:text-slate-400">ระบบจะออกเลขที่ Ticket และแจ้งทีม IT ทันที</p>
      </div>
    </form>
  );
}
