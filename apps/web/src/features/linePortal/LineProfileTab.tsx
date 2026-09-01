import { Check, Loader2, LogOut, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../../services/apiClient';
import { lineApiFetch } from '../../services/lineApiClient';
import { initialsOf } from './linePortalText';
import type { LinePortalProfile } from './types';

const FRIEND_STATUS_TEXT: Record<string, string> = {
  Friend: 'เพิ่มเพื่อนกับ LINE OA แล้ว',
  Blocked: 'บล็อก LINE OA อยู่ — จะไม่ได้รับข้อความแจ้งเตือน',
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-hairline px-4 py-3 last:border-b-0 dark:border-slate-700">
      <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <span className="min-w-0 break-words text-right text-[13px] font-semibold text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  );
}

export function LineProfileTab({ profile, onProfileSaved, onLogout }: {
  profile: LinePortalProfile;
  onProfileSaved: (fullName: string) => void;
  onLogout: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(profile.fullName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFirstAndLastName = fullName.trim().split(/\s+/).filter(Boolean).length >= 2;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const normalized = fullName.trim().replace(/\s+/g, ' ');
      const saved = await lineApiFetch<{ fullName: string }>('/api/v1/line/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName: normalized }),
      });
      onProfileSaved(saved.fullName);
      setFullName(saved.fullName);
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : 'บันทึกชื่อ–นามสกุลไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      <header className="flex items-center gap-3 border-b border-hairline bg-white px-4 py-4 dark:border-slate-700 dark:bg-slate-900">
        {profile.pictureUrl ? (
          <img src={profile.pictureUrl} alt="" className="h-12 w-12 rounded-xl object-cover" />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-950 text-sm font-bold text-white" aria-hidden="true">
            {initialsOf(profile.fullName || profile.displayName)}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{profile.fullName || profile.displayName || 'ผู้ใช้งาน'}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
            {[profile.department || 'ยังไม่ระบุฝ่าย/แผนก', `LINE: ${profile.displayName || '-'}`].join(' · ')}
          </p>
        </div>
      </header>

      <section className="mx-4 overflow-hidden rounded-card border border-hairline bg-white shadow-card dark:border-slate-700 dark:bg-slate-900">
        {editing ? (
          <div className="p-4">
            <label htmlFor="line-portal-full-name" className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              ชื่อ–นามสกุล (ใช้เป็นชื่อผู้แจ้งบนใบงานและการลงนาม)
            </label>
            <input
              id="line-portal-full-name"
              className="public-field w-full px-3 py-2.5 text-sm focus:outline-none"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              maxLength={160}
              autoComplete="name"
            />
            {error && <p className="mt-2 text-xs text-danger-700" role="alert">{error}</p>}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !hasFirstAndLastName}
                className="public-primary-button flex flex-1 items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />} บันทึก
              </button>
              <button
                type="button"
                onClick={() => { setEditing(false); setFullName(profile.fullName); setError(null); }}
                className="public-secondary-button flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold"
              >
                <X className="h-4 w-4" aria-hidden="true" /> ยกเลิก
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-hairline px-4 py-3 dark:border-slate-700">
              <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">ชื่อ–นามสกุล</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 break-words text-right text-[13px] font-semibold text-slate-800 dark:text-slate-100">{profile.fullName || '—'}</span>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="shrink-0 text-primary-700 dark:text-primary-300"
                  aria-label="แก้ไขชื่อ–นามสกุล"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            </div>
            <InfoRow label="ฝ่าย / แผนก" value={profile.department || '—'} />
            <InfoRow label="บัญชี LINE" value={profile.displayName || '—'} />
            <InfoRow label="สถานะการเชื่อมบัญชี" value={profile.linkStatus === 'Suspended' ? 'ถูกระงับ' : 'เชื่อมบัญชีแล้ว'} />
          </>
        )}
      </section>

      <p className="px-5 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
        {FRIEND_STATUS_TEXT[profile.friendStatus] ?? 'เพิ่มเพื่อนกับ LINE OA ของ LIFE IT เพื่อรับแจ้งเตือนความคืบหน้าทาง LINE'}
        {' '}ฝ่าย/แผนกและข้อมูลติดต่ออื่นแก้ไขได้โดยติดต่อส่วนงาน IT
      </p>

      <div className="px-4">
        <button
          type="button"
          onClick={onLogout}
          className="public-secondary-button flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" /> ออกจากระบบ LINE
        </button>
      </div>
    </div>
  );
}
