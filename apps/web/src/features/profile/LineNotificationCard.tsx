import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Link2, Link2Off, Loader2, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ApiError, apiFetch } from '../../services/apiClient';
import { formatThaiDateTime } from '../../utils/date';

export interface LineLinkedAccount {
  id: string;
  displayName: string;
  pictureUrl: string;
  fullName: string;
  linkStatus: string;
  friendStatus: string;
  linkedAt: string | null;
}

interface LineLinkState {
  available: boolean;
  unavailableReason: string;
  account: LineLinkedAccount | null;
}

/** สิ่งที่จะได้รับทาง LINE เมื่อเชื่อมบัญชีแล้ว — เขียนจากมุมผู้ใช้ ไม่ใช่ชื่อ event ในระบบ */
const WHAT_YOU_GET = [
  'งานที่ได้รับมอบหมายและงานที่ถูกส่งต่อมาให้ท่าน',
  'เตือนเมื่องานใกล้ผิด SLA และเมื่อผิด SLA แล้ว',
  'เอกสารและคำขอสิทธิ์ที่รอท่านอนุมัติ',
  'ข้อความใหม่ในใบงานที่ท่านเกี่ยวข้อง',
];

function ResultBanner({ result, onDismiss }: { result: 'linked' | 'error'; onDismiss: () => void }) {
  const linked = result === 'linked';
  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${linked
        ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
        : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}
    >
      {linked
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="min-w-0">
        {linked
          ? 'เชื่อมบัญชี LINE เรียบร้อยแล้ว การแจ้งเตือนถัดไปจะส่งเข้าแชท LINE ของท่านด้วย'
          : 'เชื่อมบัญชี LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หรือติดต่อส่วนงาน IT หากยังไม่ได้'}
      </span>
      <button type="button" onClick={onDismiss} className="ml-auto shrink-0 font-bold hover:underline">ปิด</button>
    </div>
  );
}

/**
 * ผู้ใช้เชื่อมบัญชี LINE ของตัวเองได้จากที่นี่ ไม่ต้องรอผู้ดูแลกดให้
 * ปุ่มพาไปทำ LINE Login แล้วกลับมาผูกที่ /line/callback ซึ่งถือทั้ง session ของแอปและของ LINE
 */
export function LineNotificationCard() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [starting, setStarting] = useState(false);
  const result = searchParams.get('line');

  const { data, isLoading } = useQuery({
    queryKey: ['line-my-link'],
    queryFn: () => apiFetch<LineLinkState>('/api/v1/line/my-link', undefined, { silent: true }),
  });

  const unlink = useMutation({
    mutationFn: () => apiFetch('/api/v1/line/my-link', { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['line-my-link'] }),
  });

  async function startLinking() {
    setStarting(true);
    try {
      const { url } = await apiFetch<{ url: string }>('/api/v1/line/login-url?returnMode=link');
      window.location.href = url;
    } catch (error) {
      setStarting(false);
      if (!(error instanceof ApiError)) throw error;
    }
  }

  function dismissResult() {
    const next = new URLSearchParams(searchParams);
    next.delete('line');
    setSearchParams(next, { replace: true });
  }

  const account = data?.account ?? null;
  const notFriend = Boolean(account) && account!.friendStatus !== 'Friend';

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-primary-600" aria-hidden="true" />
        การแจ้งเตือนผ่าน LINE
      </CardHeader>
      <CardBody className="space-y-3 text-sm">
        {(result === 'linked' || result === 'error') && <ResultBanner result={result} onDismiss={dismissResult} />}

        {isLoading && (
          <p className="flex items-center gap-2 text-slate-500" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            กำลังตรวจสอบการเชื่อมบัญชี
          </p>
        )}

        {!isLoading && data && !data.available && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            {data.unavailableReason || 'ระบบยังไม่เปิดการแจ้งเตือนผ่าน LINE'} — เมื่อผู้ดูแลเปิดใช้งานแล้วท่านจะเชื่อมบัญชีได้จากหน้านี้
          </p>
        )}

        {!isLoading && data?.available && !account && (
          <>
            <p className="text-slate-600 dark:text-slate-300">
              เชื่อมบัญชี LINE ของท่านกับบัญชีผู้ใช้นี้ เพื่อรับการแจ้งเตือนเข้าแชท LINE ควบคู่กับกระดิ่งในระบบ
            </p>
            <ul className="ml-4 list-disc space-y-1 text-xs text-slate-600 dark:text-slate-300">
              {WHAT_YOU_GET.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              ก่อนเชื่อม กรุณาเพิ่มเพื่อนกับ LINE Official Account ของส่วนงาน IT ก่อน มิฉะนั้นข้อความจะส่งไปไม่ถึง
            </p>
            <Button type="button" onClick={() => void startLinking()} isLoading={starting} disabled={starting}>
              <Link2 className="h-4 w-4" aria-hidden="true" />
              เชื่อมบัญชี LINE ของฉัน
            </Button>
          </>
        )}

        {!isLoading && account && (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-hairline p-3 dark:border-slate-700">
              {account.pictureUrl
                ? <img src={account.pictureUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
                : (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-xs font-bold text-white" aria-hidden="true">
                    LINE
                  </span>
                )}
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{account.displayName || account.fullName || 'บัญชี LINE ของท่าน'}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {account.linkedAt ? `เชื่อมเมื่อ ${formatThaiDateTime(account.linkedAt)}` : 'เชื่อมกับบัญชีผู้ใช้นี้แล้ว'}
                </p>
              </div>
            </div>

            {account.linkStatus === 'Suspended' && (
              <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                บัญชี LINE นี้ถูกระงับ จะยังไม่ได้รับการแจ้งเตือนจนกว่าผู้ดูแลจะปลดระงับ
              </p>
            )}
            {notFriend && account.linkStatus !== 'Suspended' && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {account.friendStatus === 'Blocked'
                  ? 'ท่านบล็อก LINE Official Account ของส่วนงาน IT อยู่ กรุณาปลดบล็อกเพื่อให้ข้อความส่งถึง'
                  : 'ยังไม่พบว่าท่านเพิ่มเพื่อนกับ LINE Official Account ของส่วนงาน IT ข้อความอาจส่งไปไม่ถึง'}
              </p>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={() => unlink.mutate()}
              isLoading={unlink.isPending}
              disabled={unlink.isPending}
            >
              <Link2Off className="h-4 w-4" aria-hidden="true" />
              ยกเลิกการเชื่อมบัญชี
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}
