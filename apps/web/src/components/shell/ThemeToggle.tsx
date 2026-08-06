import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../../stores/themeContext';

const CYCLE = ['light', 'dark', 'system'] as const;
const LABEL: Record<(typeof CYCLE)[number], string> = {
  light: 'โหมดสว่าง',
  dark: 'โหมดมืด',
  system: 'ตามระบบ',
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  function cycle() {
    const nextIndex = (CYCLE.indexOf(theme) + 1) % CYCLE.length;
    setTheme(CYCLE[nextIndex]);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-primary-50 hover:text-primary-700 dark:text-slate-300 dark:hover:bg-slate-700"
      aria-label={`ธีม: ${LABEL[theme]} (กดเพื่อเปลี่ยน)`}
      title={`ธีม: ${LABEL[theme]}`}
    >
      {theme === 'light' && <Sun className="h-5 w-5" aria-hidden="true" />}
      {theme === 'dark' && <Moon className="h-5 w-5" aria-hidden="true" />}
      {theme === 'system' && <Monitor className="h-5 w-5" aria-hidden="true" />}
    </button>
  );
}
