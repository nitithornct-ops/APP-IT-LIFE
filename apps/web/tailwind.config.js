/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Sarabun', 'Noto Sans Thai', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        // อ้างอิงจากธีมน้ำเงิน-ขาวของระบบเดิม (legacy-gas/Styles.html :root) เพื่อความต่อเนื่องทางสายตา
        primary: {
          50: '#eff4ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#173a8a',
        },
        sidebar: {
          DEFAULT: '#0f1f3d',
          light: '#16294d',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,31,61,.035), 0 5px 18px rgba(15,31,61,.045)',
        elevated: '0 12px 32px rgba(15,31,61,.14)',
      },
    },
  },
  plugins: [],
};
