import { useTheme } from '../../stores/themeContext';

/** ปรับขนาดตัวอักษรทั้งระบบ (A- / A+) — สืบทอดจาก .fontsize-group ของระบบเดิม */
export function FontSizeControl() {
  const { decreaseFontScale, increaseFontScale } = useTheme();

  return (
    <div className="hidden items-center gap-0.5 rounded-xl bg-primary-50 p-0.5 dark:bg-slate-700 sm:flex">
      <button
        type="button"
        onClick={decreaseFontScale}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-primary-700 hover:bg-primary-100 dark:text-primary-300 dark:hover:bg-slate-600"
        aria-label="ลดขนาดตัวอักษร"
      >
        A-
      </button>
      <button
        type="button"
        onClick={increaseFontScale}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-primary-700 hover:bg-primary-100 dark:text-primary-300 dark:hover:bg-slate-600"
        aria-label="เพิ่มขนาดตัวอักษร"
      >
        A+
      </button>
    </div>
  );
}
