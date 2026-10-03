/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['FormThai', 'Noto Sans Thai', 'Tahoma', 'Arial', 'sans-serif'],
        display: ['FormThai', 'Noto Sans Thai', 'Tahoma', 'Arial', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // LIFE IT logo foundation: navy, royal blue, gold, and white.
        primary: {
          50: '#eef5ff',
          100: '#dbeafe',
          200: '#bfd7f7',
          300: '#91b8eb',
          400: '#5f8fd1',
          500: '#3567b3',
          600: '#2454a6',
          700: '#1d4388',
          800: '#17356f',
          900: '#102a5c',
          950: '#091a3a',
        },
        accent: {
          300: '#f4d875',
          400: '#e7b928',
          500: '#d9a514',
        },
        sidebar: {
          DEFAULT: '#091a3a',
          light: '#102a5c',
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
          page: '#f5f8fc',
          header: '#eef4fb',
          muted: '#e8eef7',
        },
        hairline: {
          DEFAULT: '#d7e1ef',
          row: '#edf2f8',
          control: '#c7d5e6',
        },
        ink: {
          DEFAULT: '#10234b',
          heading: '#102a5c',
          secondary: '#334a70',
          muted: '#60708c',
          faint: '#94a3b8',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,27,54,.04), 0 8px 26px rgba(11,27,54,.07)',
        elevated: '0 18px 44px rgba(11,27,54,.16)',
        action: '0 6px 16px rgba(36,84,166,.24)',
        nav: '0 4px 12px rgba(16,42,92,.4)',
      },
      borderRadius: {
        life: '7px',
        card: '10px',
        large: '13px',
        modal: '13px',
      },
      // Keep every application layer in one named scale. Components should
      // use these names instead of introducing one-off z-index values.
      zIndex: {
        background: '0',
        content: '10',
        card: '20',
        sidebar: '30',
        'mobile-backdrop': '40',
        header: '50',
        'mobile-drawer': '60',
        dropdown: '100',
        popover: '120',
        tooltip: '150',
        'modal-backdrop': '900',
        modal: '1000',
        'modal-popover': '1050',
        toast: '1100',
        'global-loading': '1200',
      },
    },
  },
  plugins: [],
};
