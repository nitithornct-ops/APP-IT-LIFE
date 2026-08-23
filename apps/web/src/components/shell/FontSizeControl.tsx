import { useTheme } from '../../stores/themeContext';

/** ปรับขนาดตัวอักษรทั้งระบบ (A- / A+) — สืบทอดจาก .fontsize-group ของระบบเดิม */
export function FontSizeControl() {
  const { decreaseFontScale, increaseFontScale } = useTheme();

  return (
    <div className="hidden items-center gap-0.5 rounded-[7px] bg-primary-50 p-0.5 dark:bg-white/[.07] sm:flex">
      <button
        type="button"
        onClick={decreaseFontScale}
        className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[10px] font-bold text-primary-700 hover:bg-primary-100 dark:text-primary-300 dark:hover:bg-white/[.08]"
        aria-label="ลดขนาดตัวอักษร"
      >
        A-
      </button>
      <button
        type="button"
        onClick={increaseFontScale}
        className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[11px] font-bold text-primary-700 hover:bg-primary-100 dark:text-primary-300 dark:hover:bg-white/[.08]"
        aria-label="เพิ่มขนาดตัวอักษร"
      >
        A+
      </button>
    </div>
  );
}
