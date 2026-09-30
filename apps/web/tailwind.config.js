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
        // LIFE IT green/white/charcoal foundation.
        primary: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
          950: '#022c22',
        },
        accent: {
          300: '#6ee7b7',
          400: '#34d399',
          500: '#059669',
        },
        sidebar: {
          DEFAULT: '#022c22',
          light: '#064e3b',
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
          page: '#f5faf7',
          header: '#f2f8f5',
          muted: '#eaf3ee',
        },
        hairline: {
          DEFAULT: '#e3e8f2',
          row: '#f1f4fa',
          control: '#dde3ef',
        },
        ink: {
          DEFAULT: '#17231f',
          heading: '#17352b',
          secondary: '#42524a',
          muted: '#61726a',
          faint: '#94a3b8',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,27,54,.04), 0 8px 26px rgba(11,27,54,.07)',
        elevated: '0 18px 44px rgba(11,27,54,.16)',
        action: '0 6px 16px rgba(4,120,87,.24)',
        nav: '0 4px 12px rgba(4,120,87,.4)',
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
