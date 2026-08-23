import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type ThemeMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'itlife-theme';
const FONT_SCALE_STORAGE_KEY = 'itlife-font-scale';
const FONT_SCALE_STEPS = [0.9, 1, 1.1, 1.2] as const;
const DEFAULT_FONT_SCALE = 1;

interface ThemeContextValue {
  theme: ThemeMode;
  /** ธีมที่ผู้ใช้เลือกไว้ — ไม่เปลี่ยนตามหน้าที่บังคับโหมด ปุ่มสลับธีมจึงยังแสดงค่าที่ผู้ใช้ตั้งเสมอ */
  resolvedTheme: 'light' | 'dark';
  /** ธีมที่แสดงผลจริงบนหน้าจอตอนนี้ (นับรวมหน้าที่บังคับโหมดแล้ว) */
  appliedTheme: 'light' | 'dark';
  setTheme: (theme: ThemeMode) => void;
  forceTheme: (mode: 'light' | 'dark' | null) => void;
  fontScale: number;
  increaseFontScale: () => void;
  decreaseFontScale: () => void;
  resetFontScale: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

function readStoredFontScale(): number {
  const stored = Number(localStorage.getItem(FONT_SCALE_STORAGE_KEY));
  return FONT_SCALE_STEPS.includes(stored as (typeof FONT_SCALE_STEPS)[number]) ? stored : DEFAULT_FONT_SCALE;
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** จัดการ Dark mode + ขนาดตัวอักษร (A-/A/A+) ของทั้งระบบ — ค่าที่เลือกไว้จำไว้ใน localStorage เสมอ */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [fontScale, setFontScale] = useState<number>(readStoredFontScale);
  const [systemIsDark, setSystemIsDark] = useState(systemPrefersDark);
  const [forcedTheme, setForcedTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event: MediaQueryListEvent) => setSystemIsDark(event.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  const resolvedTheme = theme === 'system' ? (systemIsDark ? 'dark' : 'light') : theme;
  // หน้าที่บังคับโหมดของตัวเอง (War Room) ชนะค่าที่ผู้ใช้เลือกเฉพาะระหว่างที่เปิดอยู่ แต่ไม่เขียนทับ
  // ค่าที่จำไว้ พอออกจากหน้า ธีมเดิมของผู้ใช้จึงกลับมาเองโดยไม่ต้องคืนค่าด้วยมือ
  const appliedTheme = forcedTheme ?? resolvedTheme;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', appliedTheme === 'dark');
  }, [appliedTheme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(fontScale));
  }, [fontScale]);

  function handleSetTheme(next: ThemeMode) {
    setTheme(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  }

  function stepFontScale(direction: 1 | -1) {
    setFontScale((current) => {
      const index = FONT_SCALE_STEPS.indexOf(current as (typeof FONT_SCALE_STEPS)[number]);
      const nextIndex = Math.min(Math.max(index + direction, 0), FONT_SCALE_STEPS.length - 1);
      const next = FONT_SCALE_STEPS[nextIndex];
      localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(next));
      return next;
    });
  }

  function resetFontScale() {
    setFontScale(DEFAULT_FONT_SCALE);
    localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(DEFAULT_FONT_SCALE));
  }

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      appliedTheme,
      setTheme: handleSetTheme,
      forceTheme: setForcedTheme,
      fontScale,
      increaseFontScale: () => stepFontScale(1),
      decreaseFontScale: () => stepFontScale(-1),
      resetFontScale,
    }),
    [theme, resolvedTheme, appliedTheme, fontScale],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// The provider and its context hook intentionally share this module as one public API.
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme ต้องถูกเรียกภายใน <ThemeProvider>');
  }
  return ctx;
}

/**
 * บังคับธีมของทั้งหน้าจอตลอดเวลาที่ component ยังอยู่ แล้วคืนค่าที่ผู้ใช้เลือกไว้ให้เองตอน unmount
 *
 * ใช้กับ War Room ซึ่ง design handoff 4a กำหนดให้เป็นโหมดมืดเสมอ ถ้าหน้าไหนทาสีเข้มเฉพาะกล่องของ
 * ตัวเอง Topbar กับพื้นรอบ ๆ จะยังสว่างอยู่ กลายเป็นแถบขาวคาดกลางจอ
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useForcedTheme(mode: 'light' | 'dark') {
  const { forceTheme } = useTheme();
  useEffect(() => {
    forceTheme(mode);
    return () => forceTheme(null);
  }, [forceTheme, mode]);
}
