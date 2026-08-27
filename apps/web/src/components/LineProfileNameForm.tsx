import { Loader2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../services/apiClient';
import { lineApiFetch } from '../services/lineApiClient';

interface LineProfileNameFormProps {
  onSaved: (fullName: string) => void;
}

export function LineProfileNameForm({ onSaved }: LineProfileNameFormProps) {
  const [fullName, setFullName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFirstAndLastName = fullName.trim().split(/\s+/).length >= 2;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const profile = await lineApiFetch<{ fullName: string }>('/api/v1/line/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName }),
      });
      onSaved(profile.fullName);
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : 'บันทึกชื่อ–นามสกุลไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="public-sheet mx-auto w-full max-w-md p-5" noValidate>
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <UserRound className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-bold text-slate-900">กรอกชื่อ–นามสกุล</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">กรุณากรอกชื่อจริงของคุณ ระบบจะไม่ใช้ชื่อโปรไฟล์ LINE เป็นชื่อผู้แจ้ง</p>
        </div>
      </div>
      <label htmlFor="line-full-name" className="mb-1.5 block text-sm font-medium text-slate-700">
        ชื่อ–นามสกุล <span className="text-red-600" aria-hidden="true">*</span>
      </label>
      <input
        id="line-full-name"
        className="public-field w-full px-3 py-2.5 text-sm focus:outline-none"
        value={fullName}
        onChange={(event) => setFullName(event.target.value)}
        required
        minLength={2}
        maxLength={160}
        autoComplete="name"
        placeholder="เช่น สมชาย ใจดี"
        autoFocus
      />
      {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !hasFirstAndLastName}
        className="public-primary-button mt-4 flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        บันทึกและดำเนินการต่อ
      </button>
    </form>
  );
}
