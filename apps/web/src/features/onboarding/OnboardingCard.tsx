import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Loader2, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../services/apiClient';
import { useAuth } from '../../stores/authContext';
import type { MeProfile } from '../../stores/authContext';

/**
 * การ์ด "เริ่มใช้ครั้งแรก" (design handoff 3k)
 *
 * แสดงเฉพาะบัญชีที่ยังไม่เคยปิดการ์ดนี้ สถานะเก็บใน profiles.onboarding_* (migration 20260918100000)
 * ไม่ใช่ localStorage — ไม่งั้นผู้ใช้ที่สลับเครื่องหรือล้าง cache จะเจอการ์ดเดิมซ้ำไปเรื่อย ๆ
 *
 * ขั้นตอนที่แสดงเป็นทางลัดไปยังหน้าจริงที่บัญชีนั้นมีสิทธิ์เข้าเท่านั้น และมีเพียงขั้นแรกที่ระบบรู้ผลจริง
 * (เบอร์โทรกรอกแล้วหรือยัง) ขั้นที่เหลือจึงไม่ติ๊กถูกให้ เพราะเครื่องหมายถูกที่ระบบไม่ได้ตรวจจริง
 * ทำให้ผู้ใช้เชื่อว่าตั้งค่าครบแล้วทั้งที่ยังไม่ได้ทำ
 */

interface OnboardingStep {
  key: string;
  title: string;
  description: string;
  to: string;
  done: boolean | null;
}

function buildSteps(profile: MeProfile, hasPermission: (key: string) => boolean): OnboardingStep[] {
  const steps: OnboardingStep[] = [
    {
      key: 'profile',
      title: 'เติมเบอร์โทรในโปรไฟล์',
      description: 'ทีมงานใช้ติดต่อกลับเวลามีงานด่วนที่ต้องยืนยันกับท่านก่อน',
      to: '/profile',
      done: Boolean(profile.phone?.trim()),
    },
  ];

  if (hasPermission('dashboard.view')) {
    steps.push({
      key: 'my-work',
      title: 'ดูคิวงานของฉัน',
      description: 'รวมงานที่มอบหมายให้ท่าน คำขออนุมัติ และรายการใกล้ครบกำหนดไว้หน้าเดียว',
      to: '/my-work',
      done: null,
    });
  }
  if (hasPermission('ticket.create')) {
    steps.push({
      key: 'ticket',
      title: 'ลองเปิดใบแจ้งซ่อม',
      description: 'แจ้งปัญหาให้ทีมไอทีพร้อมแนบรูปและระบุสถานที่ได้ในหน้าเดียว',
      to: '/tickets',
      done: null,
    });
  } else if (hasPermission('knowledge.view')) {
    steps.push({
      key: 'knowledge',
      title: 'ค้นฐานความรู้',
      description: 'วิธีแก้ปัญหาที่พบบ่อยถูกรวบรวมไว้แล้ว หลายเรื่องแก้เองได้โดยไม่ต้องรอช่าง',
      to: '/knowledge',
      done: null,
    });
  }

  return steps.slice(0, 3);
}

export function OnboardingCard() {
  const { me, hasPermission, refetchMe } = useAuth();
  const queryClient = useQueryClient();

  const close = useMutation({
    mutationFn: (dismissed: boolean) =>
      apiFetch('/api/v1/auth/onboarding', { method: 'POST', body: JSON.stringify({ dismissed }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      refetchMe();
    },
  });

  if (!me) return null;
  // ฟิลด์เป็น optional เพราะฐานข้อมูลที่ยังไม่ได้รัน migration จะไม่มีคอลัมน์นี้ —
  // undefined ในกรณีนั้นถือว่า "ยังไม่เคยปิด" ตามค่าเริ่มต้นที่ปลอดภัย
  if (me.profile.onboarding_completed_at || me.profile.onboarding_dismissed_at) return null;

  const steps = buildSteps(me.profile, hasPermission);
  const firstName = me.profile.full_name.split(/\s+/)[0] || 'ผู้ใช้งาน';

  return (
    <section
      className="rounded-[12px] bg-[#0B1B36] p-5 text-white shadow-card"
      aria-labelledby="onboarding-heading"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-white/10" aria-hidden="true">
          <Sparkles className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <h2 id="onboarding-heading" className="text-[17px] font-extrabold">ยินดีต้อนรับ {firstName}</h2>
          <p className="mt-0.5 text-[12.5px] leading-5 text-white/60">
            สามอย่างนี้ช่วยให้เริ่มใช้งานได้เร็วขึ้น ข้ามไปก่อนแล้วกลับมาทำทีหลังก็ได้
          </p>
        </div>
      </div>

      <ol className="mt-4 space-y-2">
        {steps.map((step, index) => (
          <li key={step.key}>
            <Link
              to={step.to}
              className="flex min-h-[56px] items-center gap-3 rounded-[9px] bg-white/[.07] px-3 py-2.5 transition-colors hover:bg-white/[.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px] font-bold ${
                  step.done ? 'bg-success-600 text-white' : 'bg-white/15 text-white/80'
                }`}
              >
                {step.done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold">{step.title}</span>
                <span className="block truncate text-[11.5px] text-white/55">{step.description}</span>
              </span>
              {step.done && <span className="shrink-0 text-[10.5px] font-semibold text-success-100">ทำแล้ว</span>}
              <ArrowRight className="h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => close.mutate(false)}
          disabled={close.isPending}
          className="inline-flex min-h-10 items-center gap-2 rounded-[7px] bg-white px-4 text-[13px] font-bold text-[#0B1B36] hover:bg-white/90 disabled:opacity-60"
        >
          {close.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          เข้าใจแล้ว ไม่ต้องแสดงอีก
        </button>
        <button
          type="button"
          onClick={() => close.mutate(true)}
          disabled={close.isPending}
          className="inline-flex min-h-10 items-center rounded-[7px] border border-white/25 px-4 text-[13px] font-semibold text-white/80 hover:bg-white/10 disabled:opacity-60"
        >
          ข้ามไปใช้ค่าเริ่มต้น
        </button>
      </div>

      {close.isError && (
        <p className="mt-2 text-[11.5px] text-red-300" role="alert">
          ปิดคำแนะนำไม่สำเร็จ การ์ดนี้จะยังแสดงอยู่จนกว่าจะบันทึกได้ กรุณาลองใหม่อีกครั้ง
        </p>
      )}
    </section>
  );
}
