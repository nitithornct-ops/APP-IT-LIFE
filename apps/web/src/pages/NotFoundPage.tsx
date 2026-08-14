import { ArrowLeft, Compass, Home } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';

/**
 * ก่อนหน้านี้ URL ที่ไม่มีอยู่จริงจะได้หน้าจอว่างเปล่าไม่มีข้อความใด ๆ ผู้ใช้แยกไม่ออกระหว่าง
 * "พิมพ์ที่อยู่ผิด" กับ "ระบบพัง" และไม่มีทางกลับนอกจากกดปุ่ม Back ของเบราว์เซอร์
 * (พบตอน Pre-production QA audit 2026-08-13)
 *
 * วางไว้เป็น route สุดท้ายภายใน AppShell ผู้ใช้จึงยังเห็นเมนูหลักและเดินต่อได้ทันที
 */
export function NotFoundPage() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="mx-auto max-w-xl py-10">
      <Card>
        <CardBody className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <Compass className="h-12 w-12 text-slate-300 dark:text-slate-600" aria-hidden="true" />
          <p className="text-3xl font-extrabold text-slate-800 dark:text-slate-100">ไม่พบหน้าที่ต้องการ</p>
          <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
            ที่อยู่ <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-700">{location.pathname}</code>{' '}
            ไม่มีอยู่ในระบบ อาจถูกย้าย เปลี่ยนชื่อ หรือพิมพ์ที่อยู่คลาดเคลื่อน
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            หากมาจากลิงก์ภายในระบบ กรุณาแจ้งผู้ดูแลระบบเพื่อตรวจสอบ
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
              ย้อนกลับ
            </Button>
            <Link to="/">
              <Button>
                <Home className="mr-1.5 h-4 w-4" aria-hidden="true" />
                ไปหน้าแรก
              </Button>
            </Link>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
