import { Activity, ClipboardList, ShieldCheck, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardBody } from '../components/ui/Card';
import { RequirePermission } from '../components/RequirePermission';
import { useAuth } from '../stores/authContext';

export function HomePage() {
  const { me } = useAuth();

  return (
    <div className="flex flex-col gap-6">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-r from-primary-900 to-primary-600 p-6 text-white shadow-elevated sm:p-8">
        <p className="text-sm text-primary-100">ยินดีต้อนรับ</p>
        <h2 className="mt-1 text-2xl font-extrabold sm:text-3xl">{me?.profile.full_name ?? 'ผู้ใช้งาน'}</h2>
        <p className="mt-2 max-w-xl text-sm text-primary-100">
          LIFE IT Smart Service Center — ระบบบริหารจัดการงานไอทีและธรรมาภิบาลข้อมูลของกองทุนประกันชีวิต
          กำลังทยอยย้ายโมดูลจากระบบเดิมทีละส่วน
        </p>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          ทางลัด
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <RequirePermission permission="user.manage">
            <QuickLinkCard to="/admin/users" icon={<Users className="h-5 w-5" aria-hidden="true" />} label="จัดการผู้ใช้งาน" />
          </RequirePermission>
          <RequirePermission permission="role.view">
            <QuickLinkCard to="/admin/roles" icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />} label="บทบาทและสิทธิ์" />
          </RequirePermission>
          <RequirePermission permission="audit.view">
            <QuickLinkCard to="/admin/audit-logs" icon={<ClipboardList className="h-5 w-5" aria-hidden="true" />} label="Audit Log" />
          </RequirePermission>
          <QuickLinkCard to="/health" icon={<Activity className="h-5 w-5" aria-hidden="true" />} label="สถานะระบบ" />
        </div>
      </div>

      <Card>
        <CardBody className="text-sm text-slate-500 dark:text-slate-400">
          โมดูลธุรกิจหลัก (Ticket, Asset, Incident ฯลฯ) จะถูกย้ายจากระบบเดิมทีละโมดูลใน Phase 6 —
          ตอนนี้ระบบพร้อม Design System, Sidebar, Dark Mode และโครงสร้างสิทธิ์เต็มรูปแบบแล้ว
        </CardBody>
      </Card>
    </div>
  );
}

function QuickLinkCard({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-elevated dark:border-slate-700 dark:bg-slate-800"
    >
      <span className="flex h-11 w-11 min-w-[2.75rem] items-center justify-center rounded-xl bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
        {icon}
      </span>
      <span className="font-semibold text-slate-800 dark:text-slate-100">{label}</span>
    </Link>
  );
}
