/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Sarabun', 'Noto Sans Thai', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Sarabun', 'Noto Sans Thai', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // LIFE IT navy/blue foundation measured from the design handoff.
        primary: {
          50: '#eef4ff',
          100: '#eaf0ff',
          200: '#c9d8f7',
          300: '#8fb0ee',
          400: '#4b7be0',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#173a8a',
          950: '#0b1b36',
        },
        accent: {
          300: '#93b4f5',
          400: '#4b7be0',
          500: '#1d4ed8',
        },
        sidebar: {
          DEFAULT: '#0b1b36',
          light: '#173a8a',
        },
        success: {
          50: '#e7f5ec',
          100: '#d5eddd',
          600: '#15803d',
          700: '#166534',
        },
        warning: {
          50: '#fffbeb',
          100: '#fef3c7',
          600: '#d97706',
          700: '#b45309',
        },
        danger: {
          50: '#fdecec',
          100: '#f3d9d9',
          600: '#dc2626',
          700: '#b91c1c',
        },
        teal: {
          50: '#e6f3f1',
          600: '#0f766e',
          700: '#115e59',
        },
        purple: {
          50: '#f3edfe',
          600: '#7c3aed',
          700: '#6d28d9',
        },
        surface: {
          DEFAULT: '#ffffff',
          page: '#f4f6fb',
          header: '#f7f9fc',
          muted: '#eef1f7',
        },
        hairline: {
          DEFAULT: '#e3e8f2',
          row: '#f1f4fa',
          control: '#dde3ef',
        },
        ink: {
          DEFAULT: '#0f172a',
          heading: '#0b1b36',
          secondary: '#475569',
          muted: '#64748b',
          faint: '#94a3b8',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,27,54,.04), 0 8px 26px rgba(11,27,54,.07)',
        elevated: '0 18px 44px rgba(11,27,54,.16)',
        action: '0 6px 16px rgba(29,78,216,.24)',
        nav: '0 4px 12px rgba(29,78,216,.4)',
      },
      borderRadius: {
        life: '7px',
        card: '10px',
        large: '13px',
        modal: '13px',
      },
    },
  },
  plugins: [],
};
