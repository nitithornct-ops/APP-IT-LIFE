import { useTheme } from '../../stores/themeContext';

/** ปรับขนาดตัวอักษรทั้งระบบ (A- / A+) — สืบทอดจาก .fontsize-group ของระบบเดิม */
export function FontSizeControl() {
  const { decreaseFontScale, increaseFontScale } = useTheme();

  return (
    <div className="hidden items-center gap-0.5 rounded-xl bg-primary-50 p-0.5 dark:bg-white/[.07] sm:flex" role="group" aria-label="ขนาดตัวอักษร">
      <button
        type="button"
        onClick={decreaseFontScale}
        className="flex h-11 min-h-[44px] w-11 min-w-[44px] items-center justify-center rounded-lg text-sm font-bold text-primary-700 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-300 dark:hover:bg-white/[.08]"
        aria-label="ลดขนาดตัวอักษร"
      >
        A-
      </button>
      <button
        type="button"
        onClick={increaseFontScale}
        className="flex h-11 min-h-[44px] w-11 min-w-[44px] items-center justify-center rounded-lg text-sm font-bold text-primary-700 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-300 dark:hover:bg-white/[.08]"
        aria-label="เพิ่มขนาดตัวอักษร"
      >
        A+
      </button>
    </div>
  );
}
