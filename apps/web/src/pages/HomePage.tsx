import { Link } from 'react-router-dom';

export function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center dark:bg-slate-900">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
        LIFE IT Smart Service Center
      </h1>
      <p className="text-slate-500 dark:text-slate-400">
        โครง Monorepo พร้อมใช้งานแล้ว (Phase 1) — โมดูลจริงจะเริ่มเพิ่มตั้งแต่ Phase 5 เป็นต้นไป
      </p>
      <Link
        to="/health"
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        ตรวจสอบสถานะ API
      </Link>
    </main>
  );
}
