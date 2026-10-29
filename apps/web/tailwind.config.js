/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // UI metrics are independent of the document font and respect A−/A+.
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.6' }],
        sm: ['0.9375rem', { lineHeight: '1.6' }],
        base: ['1rem', { lineHeight: '1.6' }],
        lg: ['1.125rem', { lineHeight: '1.6' }],
        xl: ['1.25rem', { lineHeight: '1.6' }],
        '2xl': ['1.75rem', { lineHeight: '1.5' }],
        '3xl': ['2rem', { lineHeight: '1.5' }],
      },
      fontFamily: {
        sans: ['var(--font-app)'],
        display: ['var(--font-app)'],
        mono: ['var(--font-app)'],
      },
      colors: {
        // LIFE IT logo foundation: navy, royal blue, gold, and white.
        primary: {
          50: '#f0f9ff',
          100: '#dff3ff',
          200: '#ccecfb',
          300: '#bde8fa',
          400: '#78c6ea',
          500: '#3585b5',
          600: '#287db3',
          700: '#206994',
          800: '#1b507a',
          900: '#173e65',
          950: '#102d4f',
        },
        accent: {
          300: '#f4d875',
          400: '#dab854',
          500: '#dab854',
        },
        sidebar: {
          DEFAULT: '#102d4f',
          light: '#173e65',
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
          page: '#f0f9ff',
          header: '#e8f5ff',
          muted: '#dff3ff',
        },
        hairline: {
          DEFAULT: '#cce3f0',
          row: '#edf2f8',
          control: '#c7d5e6',
        },
        ink: {
          DEFAULT: '#173e65',
          heading: '#173e65',
          secondary: '#365976',
          muted: '#526d85',
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
        life: 'var(--radius-default)',
        card: 'var(--radius-card)',
        large: 'var(--radius-large)',
        modal: 'var(--radius-modal)',
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
